"""Bounded MP4/AVC inspection without downloads, executables or transcoding.

The parser verifies a non-fragmented ISO-BMFF container, H.264 NAL framing,
sample tables and every sample's position in mdat. Browsers still perform the
actual media decode; malformed/unsupported containers are rejected before any
durable upload. Supported browser fragments are first remuxed losslessly by
shorts_mp4; this inspector still requires ordinary sample tables. Audio is
limited to AAC-LC or mono/stereo Opus with explicit codec configuration.
Phone HEVC requires conversion by the author.
"""

from dataclasses import dataclass
import hashlib
import struct

MAX_FILE_BYTES = 20_000_000
MAX_DURATION_MS = 180_000
MAX_SAMPLES = 100_000


class MediaError(ValueError):
    pass


@dataclass(frozen=True)
class MediaInfo:
    file_bytes: int
    duration_ms: int
    width: int
    height: int
    sha256: str
    content_type: str


def _sps_dimensions(nal):
    """Read bounded H.264 SPS picture/crop dimensions, not a container claim."""
    if not 5 <= len(nal) <= 4096 or nal[0] & 31 != 7:
        raise MediaError('invalid_file')
    rbsp = bytearray()
    zeroes = 0
    for part in nal[1:]:
        if zeroes >= 2 and part == 3:
            zeroes = 0
            continue
        rbsp.append(part)
        zeroes = zeroes + 1 if part == 0 else 0
    position = 0

    def bits(n):
        nonlocal position
        if n < 0 or position + n > len(rbsp) * 8:
            raise MediaError('invalid_file')
        value = 0
        for _ in range(n):
            value = value << 1 | ((rbsp[position // 8] >> (7 - position % 8)) & 1)
            position += 1
        return value

    def ue():
        zeroes = 0
        while not bits(1):
            zeroes += 1
            if zeroes > 24:
                raise MediaError('invalid_file')
        return (1 << zeroes) - 1 + bits(zeroes)

    def se():
        value = ue()
        return (value + 1) // 2 if value & 1 else -(value // 2)

    profile = bits(8)
    bits(16)  # constraints and level
    if ue() > 31:
        raise MediaError('unsupported_file')
    chroma = 1
    if profile in (100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135):
        chroma = ue()
        if chroma not in (0, 1):
            raise MediaError('unsupported_file')
        if ue() != 0 or ue() != 0:  # eight-bit video only
            raise MediaError('unsupported_file')
        bits(1)
        if bits(1):
            for index in range(8):
                if bits(1):
                    last, current = 8, 8
                    for _ in range(16 if index < 6 else 64):
                        if current:
                            current = (last + se() + 256) % 256
                        last = current or last
    elif profile not in (66, 77, 88):
        raise MediaError('unsupported_file')
    if ue() > 12:
        raise MediaError('unsupported_file')
    order = ue()
    if order == 0:
        if ue() > 12:
            raise MediaError('unsupported_file')
    elif order == 1:
        bits(1)
        se(); se()
        count = ue()
        if count > 255:
            raise MediaError('unsupported_file')
        for _ in range(count):
            se()
    elif order != 2:
        raise MediaError('unsupported_file')
    if ue() > 16:
        raise MediaError('unsupported_file')
    bits(1)
    width, height = (ue() + 1) * 16, (ue() + 1) * 16
    frame_only = bits(1)
    if not frame_only:
        bits(1)
    height *= 2 - frame_only
    bits(1)
    if width > 4096 or height > 4096:
        raise MediaError('unsupported_file')
    if bits(1):
        left, right, top, bottom = ue(), ue(), ue(), ue()
        width -= (2 if chroma else 1) * (left + right)
        height -= (2 if chroma else 1) * (2 - frame_only) * (top + bottom)
    if not 1 <= width <= 3840 or not 1 <= height <= 3840:
        raise MediaError('unsupported_file')
    return width, height


def _opus_packet_samples(packet):
    """Validate RFC 6716 framing and return decoded duration at 48 kHz.

    This reads packet boundaries/TOC only; browsers perform entropy decoding.
    One mono/stereo stream, at most 48 frames/120 ms, and at most 1275 bytes
    per encoded frame are supported. Padding is bounded with the packet.
    """
    if not 1 <= len(packet) <= 65_536:
        raise MediaError('invalid_file')
    config, code = packet[0] >> 3, packet[0] & 3
    frame_samples = ((480, 960, 1920, 2880)[config & 3] if config < 12 else
                     (480, 960)[config & 1] if config < 16 else
                     (120, 240, 480, 960)[config & 3])
    at, end, count = 1, len(packet), 1 if code == 0 else 2

    def frame_length():
        nonlocal at
        if at >= end:
            raise MediaError('invalid_file')
        length, at = packet[at], at + 1
        if length >= 252:
            if at >= end:
                raise MediaError('invalid_file')
            length += 4 * packet[at]
            at += 1
        return length

    if code == 0:
        lengths = [end - at]
    elif code == 1:
        if (end - at) % 2:
            raise MediaError('invalid_file')
        lengths = [(end - at) // 2] * 2
    elif code == 2:
        first = frame_length()
        lengths = [first, end - at - first]
    else:
        if at >= end:
            raise MediaError('invalid_file')
        control, at = packet[at], at + 1
        count = control & 63
        if not count or count > 48 or count * frame_samples > 5760:
            raise MediaError('invalid_file')
        if control & 64:
            padding = 0
            while True:
                if at >= end:
                    raise MediaError('invalid_file')
                part, at = packet[at], at + 1
                padding += 254 if part == 255 else part
                if padding > end - at:
                    raise MediaError('invalid_file')
                if part != 255:
                    break
            end -= padding
        if control & 128:
            lengths = [frame_length() for _ in range(count - 1)]
            lengths.append(end - at - sum(lengths))
        else:
            if (end - at) % count:
                raise MediaError('invalid_file')
            lengths = [(end - at) // count] * count
    if count * frame_samples > 5760 or any(not 0 <= length <= 1275 for length in lengths):
        raise MediaError('invalid_file')
    return count * frame_samples


def inspect_mp4(data):
    if not isinstance(data, bytes) or not 32 <= len(data) <= MAX_FILE_BYTES:
        raise MediaError('invalid_file')
    boxes_seen = 0

    def u32(at):
        if at < 0 or at + 4 > len(data):
            raise MediaError('invalid_file')
        return struct.unpack_from('>I', data, at)[0]

    def boxes(start, end):
        nonlocal boxes_seen
        output = []
        at = start
        while at < end:
            boxes_seen += 1
            if boxes_seen > 5000 or end - at < 8:
                raise MediaError('invalid_file')
            length, kind = u32(at), data[at + 4:at + 8]
            header = 8
            if length == 1:
                if end - at < 16:
                    raise MediaError('invalid_file')
                length = struct.unpack_from('>Q', data, at + 8)[0]
                header = 16
            elif length == 0:
                length = end - at
            if length < header or length > end - at:
                raise MediaError('invalid_file')
            output.append((kind, at + header, at + length))
            at += length
        return output

    def one(items, kind):
        selected = [item for item in items if item[0] == kind]
        if len(selected) != 1:
            raise MediaError('invalid_file')
        return selected[0]

    def table(box, columns, width=4):
        _, start, end = box
        if end - start < 8 or data[start:start + 4] != b'\0\0\0\0':
            raise MediaError('invalid_file')
        count = u32(start + 4)
        if not 1 <= count <= MAX_SAMPLES or end - start != 8 + count * columns * width:
            raise MediaError('invalid_file')
        fmt = '>' + ('I' if width == 4 else 'Q') * columns
        return [struct.unpack_from(fmt, data, start + 8 + i * columns * width) for i in range(count)]

    top = boxes(0, len(data))
    _, ft, fe = one(top, b'ftyp')
    if fe - ft < 8 or (fe - ft) % 4 or data[ft:ft + 4] not in (
            b'isom', b'iso2', b'iso4', b'iso5', b'iso6', b'avc1', b'mp41', b'mp42', b'qt  '):
        raise MediaError('unsupported_file')
    if any(kind == b'moof' for kind, _, _ in top):
        raise MediaError('unsupported_file')
    mdats = [(start, end) for kind, start, end in top if kind == b'mdat']
    if not mdats:
        raise MediaError('invalid_file')
    _, ms, me = one(top, b'moov')
    movie = boxes(ms, me)
    _, movie_start, movie_end = one(movie, b'mvhd')

    def duration_header(start, end):
        version = data[start] if end > start else -1
        if version == 0 and end - start >= 20:
            scale, duration = u32(start + 12), u32(start + 16)
        elif version == 1 and end - start >= 32:
            scale, duration = u32(start + 20), struct.unpack_from('>Q', data, start + 24)[0]
        else:
            raise MediaError('invalid_file')
        if not scale or not duration or duration * 1000 > MAX_DURATION_MS * scale:
            raise MediaError('file_too_long')
        return scale, duration

    movie_scale, movie_duration = duration_header(movie_start, movie_end)
    tracks = [item for item in movie if item[0] == b'trak']
    if not 1 <= len(tracks) <= 2:
        raise MediaError('unsupported_file')
    ranges, durations, videos = [], [(movie_duration * 1000 + movie_scale - 1) // movie_scale], []
    for _, ts, te in tracks:
        track = boxes(ts, te)
        _, header_start, header_end = one(track, b'tkhd')
        version = data[header_start] if header_end > header_start else -1
        if version == 0 and header_end - header_start >= 84:
            track_duration = u32(header_start + 20)
        elif version == 1 and header_end - header_start >= 96:
            track_duration = struct.unpack_from('>Q', data, header_start + 28)[0]
        else:
            raise MediaError('invalid_file')
        if not track_duration or track_duration * 1000 > MAX_DURATION_MS * movie_scale:
            raise MediaError('file_too_long')
        durations.append((track_duration * 1000 + movie_scale - 1) // movie_scale)
        _, ds, de = one(track, b'mdia')
        mdia = boxes(ds, de)
        _, hs, he = one(mdia, b'hdlr')
        if he - hs < 12:
            raise MediaError('invalid_file')
        handler = data[hs + 8:hs + 12]
        if handler not in (b'vide', b'soun'):
            raise MediaError('unsupported_file')
        _, duration_start, duration_end = one(mdia, b'mdhd')
        version = data[duration_start] if duration_end > duration_start else -1
        if version == 0 and duration_end - duration_start >= 24:
            scale, duration = u32(duration_start + 12), u32(duration_start + 16)
        elif version == 1 and duration_end - duration_start >= 36:
            scale = u32(duration_start + 20)
            duration = struct.unpack_from('>Q', data, duration_start + 24)[0]
        else:
            raise MediaError('invalid_file')
        if not scale or not duration or duration * 1000 > MAX_DURATION_MS * scale:
            raise MediaError('file_too_long')
        durations.append((duration * 1000 + scale - 1) // scale)
        _, ins, ine = one(mdia, b'minf')
        media_info = boxes(ins, ine)
        _, refs_start, refs_end = one(media_info, b'dinf')
        _, refs_start, refs_end = one(boxes(refs_start, refs_end), b'dref')
        if refs_end - refs_start < 8 or data[refs_start:refs_start + 4] != b'\0\0\0\0' or u32(refs_start + 4) != 1:
            raise MediaError('unsupported_file')
        refs = boxes(refs_start + 8, refs_end)
        if len(refs) != 1 or refs[0][0] != b'url ' or data[refs[0][1]:refs[0][2]] != b'\0\0\0\1':
            # External media references must not make the browser fetch a URL
            # selected by an uploaded file. Every accepted sample is in mdat.
            raise MediaError('unsupported_file')
        _, ss, se = one(media_info, b'stbl')
        stbl = boxes(ss, se)
        _, sds, sde = one(stbl, b'stsd')
        if sde - sds < 16 or data[sds:sds + 4] != b'\0\0\0\0' or u32(sds + 4) != 1:
            raise MediaError('unsupported_file')
        entries = boxes(sds + 8, sde)
        if len(entries) != 1 or entries[0][0] not in ((b'avc1',) if handler == b'vide' else (b'mp4a', b'Opus')):
            raise MediaError('unsupported_file')
        opus_audio = handler == b'soun' and entries[0][0] == b'Opus'
        entry = entries[0]
        _, es, ee = entry
        if ee - es < 8 or struct.unpack_from('>H', data, es + 6)[0] != 1:
            raise MediaError('unsupported_file')
        if handler == b'vide':
            if ee - es < 78:
                raise MediaError('invalid_file')
            width, height = struct.unpack_from('>HH', data, es + 24)
            if not 1 <= width <= 3840 or not 1 <= height <= 3840:
                raise MediaError('unsupported_file')
            if (u32(header_end - 8) >> 16, u32(header_end - 4) >> 16) != (width, height):
                raise MediaError('unsupported_file')
            _, cs, ce = one(boxes(es + 78, ee), b'avcC')
            config = data[cs:ce]
            if len(config) < 7 or config[0] != 1 or (config[4] & 3) != 3:
                raise MediaError('unsupported_file')
            # All SPS/PPS lengths are bounded and must describe AVC units.
            pos = 6
            for count, kind in ((config[5] & 31, 7), (None, 8)):
                if count is None:
                    if pos >= len(config):
                        raise MediaError('invalid_file')
                    count, pos = config[pos], pos + 1
                if not count:
                    raise MediaError('invalid_file')
                for _ in range(count):
                    if pos + 2 > len(config):
                        raise MediaError('invalid_file')
                    size = struct.unpack_from('>H', config, pos)[0]
                    pos += 2
                    if not size or size > len(config) - pos or config[pos] & 128 or config[pos] & 31 != kind:
                        raise MediaError('invalid_file')
                    if kind == 7 and _sps_dimensions(config[pos:pos + size]) != (width, height):
                        raise MediaError('unsupported_file')
                    pos += size
            videos.append((width, height))
        else:
            audio_version = struct.unpack_from('>H', data, es + 8)[0] if ee - es >= 28 else -1
            if audio_version not in (0, 1):
                raise MediaError('unsupported_file')
            channels = struct.unpack_from('>H', data, es + 16)[0]
            if channels not in (1, 2):
                raise MediaError('unsupported_file')
            audio_children = boxes(es + (44 if audio_version == 1 else 28), ee)
            if opus_audio:
                if (audio_version != 0 or scale != 48000 or struct.unpack_from('>H', data, es + 18)[0] != 16
                        or u32(es + 24) != 48000 << 16
                        or any(child[0] not in (b'dOps', b'btrt') for child in audio_children)):
                    raise MediaError('unsupported_file')
                _, acs, ace = one(audio_children, b'dOps')
                if ace - acs != 11:
                    raise MediaError('invalid_file')
                version, output_channels, pre_skip, input_rate, output_gain, mapping = struct.unpack_from('>BBHIhB', data, acs)
                if version != 0 or output_channels != channels or mapping != 0 or input_rate > 192000:
                    raise MediaError('unsupported_file')
                bitrates = [child for child in audio_children if child[0] == b'btrt']
                if len(bitrates) > 1 or any(end - start != 12 for _, start, end in bitrates):
                    raise MediaError('invalid_file')
            else:
                wave = [child for child in audio_children if child[0] == b'wave']
                if wave:
                    if len(wave) != 1:
                        raise MediaError('invalid_file')
                    audio_children = boxes(wave[0][1], wave[0][2])
                _, acs, ace = one(audio_children, b'esds')
                config = data[acs + 4:ace]
                # A bounded MPEG-4 decoder config (object type 0x40) and AAC-LC
                # AudioSpecificConfig are required; encrypted/other codecs fail.
                def descriptor(blob, at, expected):
                    if at >= len(blob) or blob[at] != expected:
                        raise MediaError('unsupported_file')
                    at += 1
                    size = 0
                    for _ in range(4):
                        if at >= len(blob):
                            raise MediaError('invalid_file')
                        part, at = blob[at], at + 1
                        size = (size << 7) | (part & 127)
                        if not part & 128:
                            break
                    else:
                        raise MediaError('invalid_file')
                    if size > len(blob) - at:
                        raise MediaError('invalid_file')
                    return blob[at:at + size]
                esd = descriptor(config, 0, 3)
                if len(esd) < 3 or esd[2] & 224:
                    raise MediaError('unsupported_file')
                decoder = descriptor(esd, 3, 4)
                if len(decoder) < 13 or decoder[0] != 0x40:
                    raise MediaError('unsupported_file')
                asc = descriptor(decoder, 13, 5)
                if len(asc) < 2 or asc[0] >> 3 != 2 or ((asc[0] & 7) << 1 | asc[1] >> 7) > 12:
                    raise MediaError('unsupported_file')
                if (asc[1] >> 3) & 15 not in (1, 2):
                    raise MediaError('unsupported_file')
        _, zs, ze = one(stbl, b'stsz')
        if ze - zs < 12 or data[zs:zs + 4] != b'\0\0\0\0':
            raise MediaError('invalid_file')
        fixed, count = u32(zs + 4), u32(zs + 8)
        if not 1 <= count <= MAX_SAMPLES or ze - zs != 12 + (0 if fixed else count * 4):
            raise MediaError('invalid_file')
        sizes = [fixed] * count if fixed else [u32(zs + 12 + i * 4) for i in range(count)]
        if any(size < (5 if handler == b'vide' else 1) or size > MAX_FILE_BYTES for size in sizes):
            raise MediaError('invalid_file')
        timing = table(one(stbl, b'stts'), 2)
        if any(not number or not ticks for number, ticks in timing) or sum(x[0] for x in timing) != count:
            raise MediaError('invalid_file')
        if sum(number * ticks for number, ticks in timing) != duration:
            raise MediaError('invalid_file')
        # Presentation timestamps, edit lists and movie/track clocks are all
        # bounded, so a short decode duration cannot hide a very long movie.
        decode_ticks = [ticks for number, ticks in timing for _ in range(number)]
        composition = [box for box in stbl if box[0] == b'ctts']
        if len(composition) > 1:
            raise MediaError('invalid_file')
        if composition:
            _, start, end = composition[0]
            if end - start < 8 or data[start] not in (0, 1) or data[start + 1:start + 4] != b'\0\0\0':
                raise MediaError('invalid_file')
            entries = u32(start + 4)
            if not 1 <= entries <= MAX_SAMPLES or end - start != 8 + entries * 8:
                raise MediaError('invalid_file')
            offsets = []
            for i in range(entries):
                number = u32(start + 8 + i * 8)
                offset = struct.unpack_from('>i' if data[start] == 1 else '>I', data, start + 12 + i * 8)[0]
                if not number or number > count - len(offsets):
                    raise MediaError('invalid_file')
                offsets.extend([offset] * number)
            if len(offsets) != count:
                raise MediaError('invalid_file')
        else:
            offsets = [0] * count
        clock = 0
        for ticks, offset in zip(decode_ticks, offsets):
            end = clock + offset + ticks
            if abs(offset) * 1000 > MAX_DURATION_MS * scale or end * 1000 > MAX_DURATION_MS * scale:
                raise MediaError('file_too_long')
            durations.append(max(0, (end * 1000 + scale - 1) // scale))
            clock += ticks
        edits = [box for box in track if box[0] == b'edts']
        if len(edits) > 1:
            raise MediaError('invalid_file')
        if edits:
            _, start, end = one(boxes(edits[0][1], edits[0][2]), b'elst')
            if end - start < 8 or data[start] not in (0, 1):
                raise MediaError('invalid_file')
            number, width = u32(start + 4), 20 if data[start] == 1 else 12
            if not 1 <= number <= 2 or end - start != 8 + number * width:
                raise MediaError('unsupported_file')
            total = 0
            for i in range(number):
                at = start + 8 + i * width
                segment, media_time, rate, fraction = struct.unpack_from('>Qqhh' if width == 20 else '>Iihh', data, at)
                if not segment or media_time < -1 or rate != 1 or fraction != 0:
                    raise MediaError('unsupported_file')
                total += segment
                if total * 1000 > MAX_DURATION_MS * movie_scale or max(0, media_time) * 1000 > MAX_DURATION_MS * scale:
                    raise MediaError('file_too_long')
            durations.append((total * 1000 + movie_scale - 1) // movie_scale)
        chunks = table(one(stbl, b'stsc'), 3)
        offsets_box = [box for box in stbl if box[0] in (b'stco', b'co64')]
        if len(offsets_box) != 1:
            raise MediaError('invalid_file')
        offsets = table(offsets_box[0], 1, 8 if offsets_box[0][0] == b'co64' else 4)
        if chunks[0][0] != 1 or any(not n or desc != 1 or first > len(offsets) for first, n, desc in chunks):
            raise MediaError('invalid_file')
        if any(chunks[i][0] >= chunks[i + 1][0] for i in range(len(chunks) - 1)):
            raise MediaError('invalid_file')
        sample, segment, opus_samples = 0, 0, 0
        for index, (offset,) in enumerate(offsets, 1):
            if segment + 1 < len(chunks) and index >= chunks[segment + 1][0]:
                segment += 1
            for _ in range(chunks[segment][1]):
                if sample >= count:
                    raise MediaError('invalid_file')
                size = sizes[sample]
                end = offset + size
                if not any(start <= offset < end <= finish for start, finish in mdats):
                    raise MediaError('invalid_file')
                ranges.append((offset, end))
                if handler == b'vide':
                    at = offset
                    while at < end:
                        if end - at < 5:
                            raise MediaError('invalid_file')
                        length = u32(at)
                        at += 4
                        if not length or length > end - at or data[at] & 128 or not 1 <= data[at] & 31 <= 23:
                            raise MediaError('invalid_file')
                        unit = data[at] & 31
                        if unit not in (1, 5, 6, 7, 8, 9, 12):
                            raise MediaError('unsupported_file')
                        if unit == 7 and _sps_dimensions(data[at:at + length]) != (width, height):
                            raise MediaError('unsupported_file')
                        at += length
                elif opus_audio:
                    # Container clocks can jitter in MediaRecorder output.
                    # Independently bound actual packet decode time so short
                    # sample-table clocks cannot conceal more than 3 minutes.
                    if size > 65_536:
                        raise MediaError('invalid_file')
                    opus_samples += _opus_packet_samples(data[offset:end])
                    if opus_samples * 1000 > MAX_DURATION_MS * 48000:
                        raise MediaError('file_too_long')
                sample += 1
                offset = end
        if sample != count:
            raise MediaError('invalid_file')
        if opus_audio:
            durations.append((opus_samples * 1000 + 47999) // 48000)
    if len(videos) != 1:
        raise MediaError('unsupported_file')
    ranges.sort()
    if any(ranges[i][1] > ranges[i + 1][0] for i in range(len(ranges) - 1)):
        raise MediaError('invalid_file')
    width, height = videos[0]
    content_type = 'video/quicktime' if data[ft:ft + 4] == b'qt  ' else 'video/mp4'
    return MediaInfo(len(data), max(durations), width, height, hashlib.sha256(data).hexdigest(), content_type)
