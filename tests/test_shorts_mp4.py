"""Offline adversarial remux checks; fixtures are structural, not decoded video."""

import struct
import unittest

from shorts_media import MediaError, inspect_mp4, MAX_FILE_BYTES, MAX_SAMPLES
from shorts_mp4 import normalize_mp4


def atom(kind, payload):
    return struct.pack('>I4s', len(payload) + 8, kind) + payload


def full(kind, payload, flags=0, version=0):
    return atom(kind, bytes([version]) + flags.to_bytes(3, 'big') + payload)


VIDEO = struct.pack('>I', 3) + b'\x65\x88\x84'
AUDIO = b'\x21\x10'


def init_track(identity, audio=False, header_duration=0, external=False, codec=None, edit=None, reference_null=False):
    scale = 48000 if audio else 1000
    tkhd = bytearray(84)
    struct.pack_into('>I', tkhd, 12, identity)
    struct.pack_into('>I', tkhd, 20, header_duration)
    if not audio:
        struct.pack_into('>II', tkhd, 76, 640 << 16, 360 << 16)
        visual = bytearray(78)
        struct.pack_into('>H', visual, 6, 1)
        struct.pack_into('>HH', visual, 24, 640, 360)
        sps, pps = bytes.fromhex('6742001ef405017fca80'), bytes.fromhex('68ce3c80')
        config = b'\x01\x42\xc0\x1e\xff\xe1' + struct.pack('>H', len(sps)) + sps + b'\x01' + struct.pack('>H', len(pps)) + pps
        entry = atom(codec or b'avc1', visual + atom(b'avcC', config))
    else:
        audio_header = bytearray(28)
        struct.pack_into('>H', audio_header, 6, 1)
        struct.pack_into('>HH', audio_header, 16, 2, 16)
        struct.pack_into('>I', audio_header, 24, scale << 16)
        asc = b'\x05\x02\x11\x90'  # AAC-LC, 48 kHz, stereo
        decoder = b'\x40\x15' + b'\0' * 11 + asc
        esd = b'\0\x01\0' + b'\x04' + bytes([len(decoder)]) + decoder
        entry = atom(codec or b'mp4a', audio_header + full(b'esds', b'\x03' + bytes([len(esd)]) + esd))
    stsd = full(b'stsd', struct.pack('>I', 1) + entry)
    empty = b''.join(full(kind, b'\0' * (8 if kind == b'stsz' else 4)) for kind in (b'stts', b'stsc', b'stsz', b'stco'))
    url = b'\0\0\0\0https://invalid.test/media\0' if external else b'\0\0\0\1'
    if reference_null:
        url += b'\0'
    dinf = atom(b'dinf', full(b'dref', struct.pack('>I', 1) + atom(b'url ', url)))
    mdhd = full(b'mdhd', b'\0' * 8 + struct.pack('>IIHH', scale, header_duration, 0, 0))
    hdlr = full(b'hdlr', b'\0' * 4 + (b'soun' if audio else b'vide') + b'\0' * 12)
    media_header = full(b'smhd' if audio else b'vmhd', b'\0' * (4 if audio else 8))
    mdia = atom(b'mdia', mdhd + hdlr + atom(b'minf', media_header + dinf + atom(b'stbl', stsd + empty)))
    edts = b'' if edit is None else atom(b'edts', full(b'elst', struct.pack('>IIihh', 1, edit, 0, 1, 0)))
    return atom(b'trak', atom(b'tkhd', tkhd) + mdia + edts)


def fixture_fragmented(*, durations=((500, 500),), starts=None, audio=False, defaults=False,
                       composition=0, header_duration=0, external=False, codec=None,
                       declared_size=None, offset_shift=0, edit=None, sequence=None, reference_null=False):
    ftyp = atom(b'ftyp', b'isom' + struct.pack('>I', 512) + b'isomiso6avc1mp41')
    mvhd = bytearray(100)
    struct.pack_into('>II', mvhd, 12, 1000, header_duration)
    tracks = init_track(1, header_duration=header_duration, external=external, codec=codec, edit=edit, reference_null=reference_null)
    trex = full(b'trex', struct.pack('>IIIII', 1, 1, 500 if defaults else 0, len(VIDEO) if defaults else 0, 0))
    if audio:
        tracks += init_track(2, True)
        trex += full(b'trex', struct.pack('>IIIII', 2, 1, 0, 0, 0))
    result = ftyp + atom(b'moov', atom(b'mvhd', mvhd) + tracks + atom(b'mvex', trex))
    video_clock = audio_clock = 0
    for index, ticks in enumerate(durations):
        identities = [(1, ticks, VIDEO, (starts[index] if starts is not None else video_clock), composition)]
        if audio:
            identities.append((2, (24000, 24000), AUDIO, audio_clock, 0))
        def make_moof(offsets):
            contents = full(b'mfhd', struct.pack('>I', sequence[index] if sequence else index + 1))
            for track_id, durations_for_track, sample, start, cto in identities:
                fields = struct.pack('>Ii', len(durations_for_track), offsets[track_id] + offset_shift)
                flags = 1 | (0x800 if cto else 0)
                if not (defaults and track_id == 1):
                    flags |= 0x300
                for duration in durations_for_track:
                    if flags & 0x300:
                        fields += struct.pack('>II', duration, len(sample) if declared_size is None else declared_size)
                    if cto:
                        fields += struct.pack('>i', cto)
                contents += atom(b'traf', full(b'tfhd', struct.pack('>I', track_id), 0x20000)
                                 + full(b'tfdt', struct.pack('>Q', start), version=1)
                                 + full(b'trun', fields, flags, 1))
            return atom(b'moof', contents)
        provisional = make_moof({identity: 0 for identity, *_ in identities})
        offsets, payload = {}, b''
        for identity, durations_for_track, sample, *_ in identities:
            offsets[identity] = len(provisional) + 8 + len(payload)
            payload += sample * len(durations_for_track)
        result += make_moof(offsets) + atom(b'mdat', payload)
        video_clock += sum(ticks)
        audio_clock += 48000 if audio else 0
    return result


class FragmentRemuxTests(unittest.TestCase):
    def test_fragmented_video_rebuilds_seekable_sample_tables_and_preserves_samples(self):
        source = fixture_fragmented(durations=((500, 500), (500, 500)))
        with self.assertRaises(MediaError):
            inspect_mp4(source)
        output = normalize_mp4(source)
        info = inspect_mp4(output)
        self.assertEqual((2000, 640, 360), (info.duration_ms, info.width, info.height))
        self.assertNotIn(b'moof', output)
        self.assertNotIn(b'mvex', output)
        self.assertEqual(4, output.count(VIDEO))
        self.assertIn(b'stss', output)
        self.assertEqual(output, normalize_mp4(output))

    def test_two_track_aac_avc_and_trex_defaults(self):
        for source in (fixture_fragmented(audio=True), fixture_fragmented(defaults=True)):
            output = normalize_mp4(source)
            self.assertEqual(1000, inspect_mp4(output).duration_ms)
            if b'mp4a' in source:
                self.assertEqual(2, output.count(AUDIO))

    def test_chromium_empty_self_contained_url_is_canonicalized_only_when_empty(self):
        source = fixture_fragmented(reference_null=True)
        self.assertEqual(1000, inspect_mp4(normalize_mp4(source)).duration_ms)
        for payload in (b'\0\0\0\1A', b'\0\0\0\0\0'):
            changed = source.replace(b'url \0\0\0\1\0', b'url ' + payload)
            with self.assertRaises(MediaError):
                normalize_mp4(changed)

    def test_many_empty_mdats_do_not_require_a_linear_scan_for_every_sample(self):
        source = fixture_fragmented(durations=((1,) * MAX_SAMPLES,), defaults=True, offset_shift=32000)
        duration_at = source.index(b'trex') + 16
        source = source[:duration_at] + struct.pack('>I', 1) + source[duration_at + 4:]
        mdat_at = source.index(b'mdat') - 4
        source = source[:mdat_at] + atom(b'mdat', b'') * 4000 + source[mdat_at:]
        self.assertEqual(100000, inspect_mp4(normalize_mp4(source)).duration_ms)

    def test_composition_timestamps_and_zero_length_edit_are_preserved(self):
        output = normalize_mp4(fixture_fragmented(composition=10, edit=0))
        self.assertEqual(1010, inspect_mp4(output).duration_ms)
        self.assertIn(b'ctts', output)
        self.assertIn(b'elst', output)
        output = normalize_mp4(fixture_fragmented(composition=-10))
        self.assertEqual(1000, inspect_mp4(output).duration_ms)

    def test_fragment_rounding_preserves_following_exact_decode_timestamp(self):
        output = normalize_mp4(fixture_fragmented(durations=((500, 500), (500,)), starts=(0, 1001)))
        self.assertEqual(1501, inspect_mp4(output).duration_ms)

    def test_malformed_ranges_clocks_codecs_refs_and_hybrid_tables_fail_closed(self):
        cases = [fixture_fragmented(offset_shift=-1), fixture_fragmented(offset_shift=1),
                 fixture_fragmented(declared_size=200), fixture_fragmented(starts=(1,)),
                 fixture_fragmented(durations=((500,), (500,)), starts=(0, 1000)),
                 fixture_fragmented(durations=((500,), (500,)), starts=(0, 0)),
                 fixture_fragmented(durations=((180001,),)), fixture_fragmented(composition=180001),
                 fixture_fragmented(header_duration=180001), fixture_fragmented(edit=180001),
                 fixture_fragmented(external=True), fixture_fragmented(codec=b'hvc1'),
                 fixture_fragmented(durations=((500,), (500,)), sequence=(1, 1))]
        source = fixture_fragmented()
        cases.extend([source[:-1], source.replace(full(b'stts', b'\0' * 4), full(b'stts', struct.pack('>III', 1, 1, 1000))),
                      source.replace(b'\x65\x88\x84', b'\xe5\x88\x84'), source + atom(b'pssh', b'\0' * 20),
                      source.replace(b'\x67\x42\x00\x1e', b'\x68\x42\x00\x1e')])
        for case in cases:
            with self.subTest(bytes=len(case)), self.assertRaises(MediaError):
                normalize_mp4(case)

    def test_bad_box_and_sample_counts_are_bounded(self):
        source = fixture_fragmented()
        count_at = source.index(b'trun') + 8
        huge_count = source[:count_at] + struct.pack('>I', MAX_SAMPLES + 1) + source[count_at + 4:]
        moov_at = source.index(b'moov') - 4
        moov_size = struct.unpack_from('>I', source, moov_at)[0]
        metadata = atom(b'free', b'\0' * 262144)
        huge_init = (source[:moov_at] + struct.pack('>I', moov_size + len(metadata))
                     + source[moov_at + 4:moov_at + moov_size] + metadata + source[moov_at + moov_size:])
        for value in (b'not video', huge_count, source + atom(b'free', b'') * 5001,
                      huge_init, b'\0' * (MAX_FILE_BYTES + 1)):
            with self.assertRaises(MediaError):
                normalize_mp4(value)


if __name__ == '__main__':
    unittest.main()
