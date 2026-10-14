"""Bounded Opus-in-MP4 checks, including a synthetic Chrome recorder fixture."""

import hashlib
from pathlib import Path
import struct
import unittest

from shorts_media import MediaError, _opus_packet_samples, inspect_mp4
from shorts_mp4 import normalize_mp4
from tests.test_shorts_mp4 import VIDEO, atom, full, init_track


def fixture_opus(*, packet=b'\xf8X', count=1, ticks=960, dops=None, channels=2,
                 scale=48000, sample_rate=48000, sample_bits=16, audio_version=0,
                 audio_codec=b'Opus', external=False, extra=b''):
    if dops is None:
        dops = struct.pack('>BBHIhB', 0, channels, 3840, 48000, 0, 0)
    header = bytearray(28)
    struct.pack_into('>H', header, 6, 1)
    struct.pack_into('>H', header, 8, audio_version)
    struct.pack_into('>HH', header, 16, channels, sample_bits)
    struct.pack_into('>I', header, 24, sample_rate << 16)
    stsd = full(b'stsd', struct.pack('>I', 1) + atom(audio_codec, header + atom(b'dOps', dops) + extra))
    empty = b''.join(full(kind, b'\0' * (8 if kind == b'stsz' else 4)) for kind in (b'stts', b'stsc', b'stsz', b'stco'))
    reference = b'\0\0\0\0https://invalid.test/media\0' if external else b'\0\0\0\1'
    dinf = atom(b'dinf', full(b'dref', struct.pack('>I', 1) + atom(b'url ', reference)))
    mdhd = full(b'mdhd', b'\0' * 8 + struct.pack('>IIHH', scale, 0, 0, 0))
    hdlr = full(b'hdlr', b'\0' * 4 + b'soun' + b'\0' * 12)
    minf = atom(b'minf', full(b'smhd', b'\0' * 4) + dinf + atom(b'stbl', stsd + empty))
    tkhd = bytearray(84)
    struct.pack_into('>I', tkhd, 12, 2)
    audio_track = atom(b'trak', atom(b'tkhd', tkhd) + atom(b'mdia', mdhd + hdlr + minf))
    mvhd = bytearray(100)
    struct.pack_into('>I', mvhd, 12, 1000)
    trex = b''.join(full(b'trex', struct.pack('>IIIII', identity, 1, 0, 0, 0)) for identity in (1, 2))
    moov = atom(b'moov', atom(b'mvhd', mvhd) + init_track(1) + audio_track + atom(b'mvex', trex))
    def moof(video_at, audio_at):
        video_run = full(b'trun', struct.pack('>IiII', 1, video_at, 1000, len(VIDEO)), 0x301)
        audio_run = full(b'trun', struct.pack('>Ii', count, audio_at) + struct.pack('>II', ticks, len(packet)) * count, 0x301)
        tracks = b''
        for identity, run in ((1, video_run), (2, audio_run)):
            tracks += atom(b'traf', full(b'tfhd', struct.pack('>I', identity), 0x20000)
                           + full(b'tfdt', struct.pack('>I', 0)) + run)
        return atom(b'moof', full(b'mfhd', struct.pack('>I', 1)) + tracks)
    size = len(moof(0, 0))
    ftyp = atom(b'ftyp', b'isom' + struct.pack('>I', 0) + b'isomiso2iso6avc1')
    return ftyp + moov + moof(size + 8, size + 8 + len(VIDEO)) + atom(b'mdat', VIDEO + packet * count)


class OpusMediaTests(unittest.TestCase):
    def test_valid_mono_stereo_and_packet_variants(self):
        packets = ((b'\xf8X', 960), (b'\xf9XX', 1920), (b'\xfa\x01XY', 1920),
                   (b'\xff\x03XYZ', 2880), (b'\xff\x83\x01\x00XY', 2880),
                   (b'\xff\x43\x01XYZP', 2880), (b'\x83\x30' + b'X' * 48, 5760),
                   (b'\xf8', 960), (b'\xfa\0', 1920))
        for packet, samples in packets:
            with self.subTest(packet=packet[:8]):
                self.assertEqual(samples, _opus_packet_samples(packet))
                output = normalize_mp4(fixture_opus(packet=packet, ticks=samples))
                self.assertEqual(1000, inspect_mp4(output).duration_ms)
        output = normalize_mp4(fixture_opus(channels=1, packet=b'\xf8X'))
        self.assertEqual((640, 360), (inspect_mp4(output).width, inspect_mp4(output).height))

    def test_invalid_dops_versions_channel_maps_counts_and_rates_fail_closed(self):
        good = struct.pack('>BBHIhB', 0, 2, 3840, 48000, 0, 0)
        configs = [good[:-1], good + b'\0', bytes([1]) + good[1:], good[:1] + bytes([0]) + good[2:],
                   good[:1] + bytes([1]) + good[2:], good[:1] + bytes([3]) + good[2:], good[:-1] + bytes([1]),
                   struct.pack('>BBHIhB', 0, 2, 3840, 0xffffffff, 0, 0)]
        for config in configs:
            with self.subTest(config=config.hex()), self.assertRaises(MediaError):
                normalize_mp4(fixture_opus(dops=config))
        for options in ({'channels': 0}, {'channels': 3}, {'scale': 44100}, {'sample_rate': 44100},
                        {'sample_bits': 24}, {'audio_version': 1}, {'audio_codec': b'fLaC'}, {'external': True},
                        {'extra': atom(b'dOps', good)}, {'extra': atom(b'sinf', b'\0' * 12)}):
            with self.subTest(options=options), self.assertRaises(MediaError):
                normalize_mp4(fixture_opus(**options))

    def test_malformed_packet_lengths_counts_padding_and_frame_bounds_fail(self):
        packets = [b'', b'\xf9X', b'\xfa', b'\xfa\xff', b'\xfa\x02X', b'\xff', b'\xff\0',
                   b'\xff\x07XXXXXXX', b'\xff\x03XX', b'\xff\x43\xff', b'\xff\x43\x10X',
                   b'\xff\x83\xff', b'\xff\x83\x01\x02X', b'\xf8' + b'X' * 1276,
                   b'\xff\x03' + b'X' * (1276 * 3), b'\xf8' + b'X' * 65536]
        for packet in packets:
            with self.subTest(packet=packet[:12]), self.assertRaises(MediaError):
                _opus_packet_samples(packet)
            if packet:
                with self.assertRaises(MediaError):
                    normalize_mp4(fixture_opus(packet=packet))

    def test_encoded_duration_cannot_hide_behind_short_sample_table_clock(self):
        # 1501 valid 120ms packets claim one clock tick each: decoded sound is
        # over 180s even though every source/container duration appears short.
        packet = b'\x83\x30' + b'X' * 48
        with self.assertRaises(MediaError) as error:
            normalize_mp4(fixture_opus(packet=packet, count=1501, ticks=1))
        self.assertEqual('file_too_long', str(error.exception))
        output = normalize_mp4(fixture_opus(packet=packet, count=1500, ticks=1))
        self.assertEqual(180000, inspect_mp4(output).duration_ms)
        with self.assertRaises(MediaError):
            normalize_mp4(fixture_opus(ticks=180001 * 48))

    def test_actual_chrome_canvas_opus_fixture_is_accepted_without_changed_samples(self):
        source = (Path(__file__).parent / 'fixtures/shorts-opus-chrome-20261015.mp4').read_bytes()
        self.assertEqual('07bed6bbf292aa02a39bb073f8db4b9f809f9d25b0891ffc8763c364f5ede73a', hashlib.sha256(source).hexdigest())
        output = normalize_mp4(source)
        info = inspect_mp4(output)
        self.assertEqual((2997, 160, 288), (info.duration_ms, info.width, info.height))
        self.assertEqual('90bfd1adb5d9a9aec17b6d6931e88d82c2f4d2253428e54fd06fd0951ef1504d', info.sha256)
        self.assertEqual(output, normalize_mp4(output))


if __name__ == '__main__':
    unittest.main()
