"""Bounded, lossless remux for AVC with AAC/Opus MediaRecorder MP4 fragments.

Only local, self-contained recordings are supported. Encoded samples and codec
descriptions are copied unchanged; there is no decoder, executable or network
access. Both source timing claims and the rebuilt ordinary MP4 are validated.
This deliberately does not implement the full ISO-BMFF format.
"""

from dataclasses import dataclass, field
from bisect import bisect_right
import struct

from shorts_media import MAX_DURATION_MS, MAX_FILE_BYTES, MAX_SAMPLES, MediaError, inspect_mp4


def _atom(kind, payload):
    return struct.pack('>I4s', len(payload) + 8, kind) + payload


def _table(kind, rows, signed=False):
    payload = bytearray(b'\x01\0\0\0' if signed else b'\0' * 4)
    payload.extend(struct.pack('>I', len(rows)))
    for row in rows:
        for index, value in enumerate(row):
            if not (-(1 << 31) <= value < 1 << 31 if signed and index else 0 <= value < 1 << 32):
                raise MediaError('unsupported_file')
            payload.extend(struct.pack('>i' if signed and index else '>I', value))
    return _atom(kind, payload)


def _runs(values):
    rows = []
    for value in values:
        if rows and rows[-1][1] == value:
            rows[-1] = (rows[-1][0] + 1, value)
        else:
            rows.append((1, value))
    return rows


@dataclass(frozen=True)
class _Box:
    kind: bytes
    at: int
    start: int
    end: int


@dataclass
class _Track:
    id: int
    handler: bytes
    scale: int
    boxes: list
    mdia: list
    minf: list
    stsd: _Box
    tkhd: _Box
    mdhd: _Box
    defaults: tuple = (0, 0, 0)
    reference: bytes = b''
    samples: list = field(default_factory=list)  # (file position, bytes, ticks, composition, flags)
    clock: int = 0
    last_dts: int = 0


class _Reader:
    def __init__(self, data):
        self.data = data
        self.seen = 0

    def number(self, at, width=4, signed=False, end=None):
        if at < 0 or at + width > (len(self.data) if end is None else end):
            raise MediaError('invalid_file')
        return int.from_bytes(self.data[at:at + width], 'big', signed=signed)

    def boxes(self, start, end):
        result = []
        while start < end:
            self.seen += 1
            if self.seen > 5000 or end - start < 8:
                raise MediaError('invalid_file')
            length = self.number(start)
            header = 8
            if length == 1:
                header, length = 16, self.number(start + 8, 8, end=end)
            elif length == 0:
                length = end - start
            if length < header or length > end - start:
                raise MediaError('invalid_file')
            result.append(_Box(self.data[start + 4:start + 8], start, start + header, start + length))
            start += length
        return result

    def children(self, box):
        return self.boxes(box.start, box.end)

    def raw(self, box):
        return self.data[box.at:box.end]

    def full(self, box, versions=(0,)):
        if box.end - box.start < 4 or self.data[box.start] not in versions:
            raise MediaError('invalid_file')
        return self.data[box.start], self.number(box.start + 1, 3, end=box.end)

    @staticmethod
    def one(boxes, kind):
        selected = [box for box in boxes if box.kind == kind]
        if len(selected) != 1:
            raise MediaError('invalid_file')
        return selected[0]

    def header(self, box, scale=None):
        version, _ = self.full(box, (0, 1))
        if box.kind == b'tkhd':
            if box.end - box.start < (84 if version == 0 else 96):
                raise MediaError('invalid_file')
            duration_at, width = box.start + (20 if version == 0 else 28), 4 if version == 0 else 8
        else:
            scale_at = box.start + (12 if version == 0 else 20)
            scale = self.number(scale_at, end=box.end)
            duration_at, width = scale_at + 4, 4 if version == 0 else 8
            if box.end - box.start < (24 if version == 0 else 36):
                raise MediaError('invalid_file')
        duration = self.number(duration_at, width, end=box.end)
        self.bound(duration, scale)
        return scale, duration_at, width

    @staticmethod
    def bound(ticks, scale):
        if not scale:
            raise MediaError('invalid_file')
        if abs(ticks) * 1000 > MAX_DURATION_MS * scale:
            raise MediaError('file_too_long')

    def duration(self, box, ticks, scale=None):
        _, at, width = self.header(box, scale)
        if not 0 < ticks < 1 << (width * 8):
            raise MediaError('unsupported_file')
        raw = bytearray(self.raw(box))
        raw[at - box.at:at - box.at + width] = ticks.to_bytes(width, 'big')
        return bytes(raw)


def normalize_mp4(data):
    """Return validated ordinary MP4/MOV bytes, remuxing supported fragments.

    Ordinary files pass through unchanged after inspection. Fragmented inputs
    require one AVC track and optionally one AAC-LC or mono/stereo Opus track,
    whose codec descriptions/packet framing are validated by inspect_mp4,
    empty init tables,
    explicit per-fragment decode times and contained, non-overlapping samples.
    Only up to one millisecond of fragment-boundary rounding is reconciled;
    discontinuous or non-monotonic recording clocks fail closed.
    """
    if not isinstance(data, bytes) or not 32 <= len(data) <= MAX_FILE_BYTES:
        raise MediaError('invalid_file')
    reader = _Reader(data)
    top = reader.boxes(0, len(data))
    fragments = [box for box in top if box.kind == b'moof']
    if not fragments:
        inspect_mp4(data)
        return data
    allowed_top = {b'ftyp', b'moov', b'moof', b'mdat', b'free', b'skip', b'styp', b'sidx', b'mfra'}
    if any(box.kind not in allowed_top for box in top):
        raise MediaError('unsupported_file')
    ftyp = reader.one(top, b'ftyp')
    moov = reader.one(top, b'moov')
    if moov.at > fragments[0].at or ftyp.at > moov.at:
        raise MediaError('invalid_file')
    if moov.end - moov.at > 262_144 or ftyp.end - ftyp.at > 4096:
        # Browser recorder initialization is small. Do not repeatedly copy a
        # file-sized codec/metadata box while rebuilding nested containers.
        raise MediaError('unsupported_file')
    # Validate the original brand before rebuilding the container.
    if ftyp.end - ftyp.start < 8 or (ftyp.end - ftyp.start) % 4 or data[ftyp.start:ftyp.start + 4] not in (
            b'isom', b'iso2', b'iso4', b'iso5', b'iso6', b'avc1', b'mp41', b'mp42', b'qt  '):
        raise MediaError('unsupported_file')
    movie = reader.children(moov)
    if any(box.kind not in (b'mvhd', b'trak', b'mvex', b'udta', b'free') for box in movie):
        raise MediaError('unsupported_file')
    mvhd = reader.one(movie, b'mvhd')
    movie_scale, _, _ = reader.header(mvhd)
    mvex = reader.children(reader.one(movie, b'mvex'))
    defaults = {}
    for box in mvex:
        if box.kind == b'mehd':
            version, flags = reader.full(box, (0, 1))
            width = 4 if version == 0 else 8
            if flags or box.end - box.start != 4 + width:
                raise MediaError('invalid_file')
            reader.bound(reader.number(box.start + 4, width), movie_scale)
        elif box.kind == b'trex':
            if reader.full(box) != (0, 0) or box.end - box.start != 24:
                raise MediaError('invalid_file')
            identity, description, duration, size, flags = struct.unpack_from('>IIIII', data, box.start + 4)
            if not identity or identity in defaults or description != 1:
                raise MediaError('unsupported_file')
            defaults[identity] = (duration, size, flags)
        else:
            raise MediaError('unsupported_file')
    tracks = {}
    for trak in [box for box in movie if box.kind == b'trak']:
        children = reader.children(trak)
        if any(box.kind not in (b'tkhd', b'mdia', b'edts', b'udta', b'free') for box in children):
            raise MediaError('unsupported_file')
        tkhd = reader.one(children, b'tkhd')
        reader.header(tkhd, movie_scale)
        version, _ = reader.full(tkhd, (0, 1))
        identity = reader.number(tkhd.start + (12 if version == 0 else 20))
        mdia = reader.children(reader.one(children, b'mdia'))
        if any(box.kind not in (b'mdhd', b'hdlr', b'minf') for box in mdia):
            raise MediaError('unsupported_file')
        mdhd = reader.one(mdia, b'mdhd')
        scale, _, _ = reader.header(mdhd)
        hdlr = reader.one(mdia, b'hdlr')
        if hdlr.end - hdlr.start < 12:
            raise MediaError('invalid_file')
        handler = data[hdlr.start + 8:hdlr.start + 12]
        if handler not in (b'vide', b'soun') or not identity or identity in tracks or identity not in defaults:
            raise MediaError('unsupported_file')
        minf = reader.children(reader.one(mdia, b'minf'))
        if any(box.kind not in (b'vmhd', b'smhd', b'dinf', b'stbl') for box in minf):
            raise MediaError('unsupported_file')
        references = reader.children(reader.one(minf, b'dinf'))
        dref = reader.one(references, b'dref')
        if len(references) != 1 or reader.full(dref) != (0, 0) or reader.number(dref.start + 4, end=dref.end) != 1:
            raise MediaError('unsupported_file')
        urls = reader.boxes(dref.start + 8, dref.end)
        if len(urls) != 1 or urls[0].kind != b'url ' or data[urls[0].start:urls[0].end] not in (b'\0\0\0\1', b'\0\0\0\1\0'):
            raise MediaError('unsupported_file')
        # Chromium writes the empty location's NUL even with self-contained
        # flag 1. Canonicalize that exact empty form, never an external URL.
        reference = _atom(b'dinf', _atom(b'dref', b'\0' * 4 + struct.pack('>I', 1) + _atom(b'url ', b'\0\0\0\1')))
        stbl = reader.children(reader.one(minf, b'stbl'))
        stsd = reader.one(stbl, b'stsd')
        if len({box.kind for box in stbl}) != len(stbl):
            raise MediaError('invalid_file')
        for kind in (b'stts', b'stsc', b'stsz'):
            reader.one(stbl, kind)
        if len([box for box in stbl if box.kind in (b'stco', b'co64')]) != 1:
            raise MediaError('invalid_file')
        for box in stbl:
            if box.kind == b'stsd':
                continue
            if box.kind not in (b'stts', b'stsc', b'stsz', b'stco', b'co64', b'ctts', b'stss'):
                raise MediaError('unsupported_file')
            if reader.full(box, (0, 1) if box.kind == b'ctts' else (0,))[1]:
                raise MediaError('invalid_file')
            # Hybrid ordinary/fragmented tables could conceal media or clocks.
            if data[box.start + 4:box.end] != (b'\0' * (8 if box.kind == b'stsz' else 4)):
                raise MediaError('unsupported_file')
        reader.bound(defaults[identity][0], scale)
        tracks[identity] = _Track(identity, handler, scale, children, mdia, minf, stsd, tkhd, mdhd, defaults[identity], reference)
    if not 1 <= len(tracks) <= 2 or set(defaults) != set(tracks) or sum(track.handler == b'vide' for track in tracks.values()) != 1:
        raise MediaError('unsupported_file')
    ranges, samples_seen, previous_sequence = [], 0, None
    for fragment_index, moof in enumerate(fragments):
        limit = fragments[fragment_index + 1].at if fragment_index + 1 < len(fragments) else len(data)
        mdats = [box for box in top if box.kind == b'mdat' and moof.end <= box.at < limit]
        if not mdats:
            raise MediaError('invalid_file')
        mdat_starts = [box.start for box in mdats]
        children = reader.children(moof)
        if any(box.kind not in (b'mfhd', b'traf') for box in children):
            raise MediaError('unsupported_file')
        mfhd = reader.one(children, b'mfhd')
        if reader.full(mfhd) != (0, 0) or mfhd.end - mfhd.start != 8:
            raise MediaError('invalid_file')
        sequence = reader.number(mfhd.start + 4)
        if previous_sequence is not None and sequence <= previous_sequence:
            raise MediaError('invalid_file')
        previous_sequence = sequence
        trafs = [box for box in children if box.kind == b'traf']
        if not 1 <= len(trafs) <= len(tracks):
            raise MediaError('invalid_file')
        seen_tracks = set()
        for traf in trafs:
            children = reader.children(traf)
            if any(box.kind not in (b'tfhd', b'tfdt', b'trun') for box in children):
                raise MediaError('unsupported_file')
            tfhd = reader.one(children, b'tfhd')
            _, flags = reader.full(tfhd)
            if flags & ~0x03003b or flags & 0x010000 or flags & 1 and flags & 0x020000:
                raise MediaError('unsupported_file')
            at = tfhd.start + 4
            identity = reader.number(at, end=tfhd.end)
            at += 4
            if identity not in tracks or identity in seen_tracks:
                raise MediaError('invalid_file')
            seen_tracks.add(identity)
            track = tracks[identity]
            base = moof.at
            if flags & 1:
                base, at = reader.number(at, 8, end=tfhd.end), at + 8
            elif not flags & 0x020000 and len(trafs) != 1:
                raise MediaError('unsupported_file')
            if flags & 2:
                if reader.number(at, end=tfhd.end) != 1:
                    raise MediaError('unsupported_file')
                at += 4
            default_duration, default_size, default_flags = track.defaults
            values = [default_duration, default_size, default_flags]
            for index, flag in enumerate((8, 16, 32)):
                if flags & flag:
                    values[index], at = reader.number(at, end=tfhd.end), at + 4
            if at != tfhd.end:
                raise MediaError('invalid_file')
            default_duration, default_size, default_flags = values
            reader.bound(default_duration, track.scale)
            tfdt = reader.one(children, b'tfdt')
            version, flags = reader.full(tfdt, (0, 1))
            width = 8 if version == 1 else 4
            if flags or tfdt.end - tfdt.start != 4 + width:
                raise MediaError('invalid_file')
            dts = reader.number(tfdt.start + 4, width)
            reader.bound(dts, track.scale)
            runs = [box for box in children if box.kind == b'trun']
            if not runs:
                raise MediaError('invalid_file')
            fragment_samples = []
            offset = None
            for run in runs:
                version, flags = reader.full(run, (0, 1))
                if flags & ~0x000f05 or flags & 4 and flags & 0x400:
                    raise MediaError('unsupported_file')
                count = reader.number(run.start + 4, end=run.end)
                if count > MAX_SAMPLES - samples_seen:
                    raise MediaError('invalid_file')
                samples_seen += count
                at = run.start + 8
                if flags & 1:
                    offset, at = base + reader.number(at, signed=True, end=run.end), at + 4
                if offset is None:
                    raise MediaError('unsupported_file')
                first_flags = default_flags
                if flags & 4:
                    first_flags, at = reader.number(at, end=run.end), at + 4
                columns = sum(bool(flags & flag) for flag in (0x100, 0x200, 0x400, 0x800))
                if run.end - at != count * columns * 4:
                    raise MediaError('invalid_file')
                for index in range(count):
                    values = [default_duration, default_size, first_flags if index == 0 else default_flags, 0]
                    for column, flag in enumerate((0x100, 0x200, 0x400, 0x800)):
                        if flags & flag:
                            values[column] = reader.number(at, signed=column == 3 and version == 1, end=run.end)
                            at += 4
                    duration, size, sample_flags, composition = values
                    if not duration or not (5 if track.handler == b'vide' else 1) <= size <= MAX_FILE_BYTES:
                        raise MediaError('invalid_file')
                    reader.bound(duration, track.scale)
                    reader.bound(composition, track.scale)
                    reader.bound(dts + duration, track.scale)
                    reader.bound(dts + composition + duration, track.scale)
                    mdat_index = bisect_right(mdat_starts, offset) - 1
                    if mdat_index < 0 or not offset < offset + size <= mdats[mdat_index].end:
                        raise MediaError('invalid_file')
                    ranges.append((offset, offset + size))
                    fragment_samples.append((offset, size, duration, composition, sample_flags))
                    offset += size
                    dts += duration
            if fragment_samples:
                first_dts = reader.number(tfdt.start + 4, width)
                if not track.samples and first_dts != 0:
                    raise MediaError('unsupported_file')
                if track.samples and first_dts != track.clock:
                    # MediaRecorder may round its fragment's final inferred
                    # frame duration; preserve the next exact decode timestamp.
                    if abs(first_dts - track.clock) * 1000 > track.scale or first_dts <= track.last_dts:
                        raise MediaError('unsupported_file')
                    old = track.samples[-1]
                    track.samples[-1] = (old[0], old[1], first_dts - track.last_dts, old[3], old[4])
                track.samples.extend(fragment_samples)
                track.clock = dts
                track.last_dts = dts - fragment_samples[-1][2]
    ranges.sort()
    if not ranges or any(ranges[index][1] > ranges[index + 1][0] for index in range(len(ranges) - 1)):
        raise MediaError('invalid_file')
    ftyp_bytes = reader.raw(ftyp)
    # Build a single bounded output buffer; avoid another full-sized mdat copy.
    payload = bytearray(ftyp_bytes + b'\0\0\0\0mdat')
    rebuilt = []
    movie_duration = 0
    for track in tracks.values():
        if not track.samples:
            raise MediaError('invalid_file')
        chunk_at = len(payload)
        for at, size, _, _, _ in track.samples:
            payload.extend(data[at:at + size])
        duration = sum(sample[2] for sample in track.samples)
        reader.bound(duration, track.scale)
        clock, presentation_end = 0, duration
        for sample in track.samples:
            presentation_end = max(presentation_end, clock + sample[3] + sample[2])
            clock += sample[2]
        reader.bound(presentation_end, track.scale)
        track_duration = (presentation_end * movie_scale + track.scale - 1) // track.scale
        movie_duration = max(movie_duration, track_duration)
        stbl = reader.raw(track.stsd)
        stbl += _table(b'stts', _runs([sample[2] for sample in track.samples]))
        stbl += _table(b'stsc', [(1, len(track.samples), 1)])
        stbl += _atom(b'stsz', b'\0' * 8 + struct.pack('>I', len(track.samples)) + b''.join(struct.pack('>I', sample[1]) for sample in track.samples))
        stbl += _table(b'stco', [(chunk_at,)])
        compositions = [sample[3] for sample in track.samples]
        if any(compositions):
            stbl += _table(b'ctts', _runs(compositions), signed=any(value < 0 for value in compositions))
        if track.handler == b'vide':
            sync = [(index,) for index, sample in enumerate(track.samples, 1) if not sample[4] & 0x10000]
            if not sync or sync[0] != (1,):
                raise MediaError('unsupported_file')
            stbl += _table(b'stss', sync)
        minf = b''.join(_atom(b'stbl', stbl) if box.kind == b'stbl' else track.reference if box.kind == b'dinf' else reader.raw(box) for box in track.minf)
        mdia = b''.join(reader.duration(box, duration) if box.kind == b'mdhd' else _atom(b'minf', minf) if box.kind == b'minf' else reader.raw(box) for box in track.mdia)
        contents = bytearray()
        for box in track.boxes:
            if box.kind == b'tkhd':
                contents.extend(reader.duration(box, track_duration, movie_scale))
            elif box.kind == b'mdia':
                contents.extend(_atom(b'mdia', mdia))
            elif box.kind == b'edts':
                # Preserve bounded codec priming/edit offsets. A zero-length
                # fragmented edit spans the completed track after remux.
                edits = reader.children(box)
                if len(edits) != 1:
                    raise MediaError('unsupported_file')
                elst = reader.one(edits, b'elst')
                version, flags = reader.full(elst, (0, 1))
                width = 20 if version else 12
                count = reader.number(elst.start + 4, end=elst.end)
                if flags or count != 1 or elst.end - elst.start != 8 + width:
                    raise MediaError('unsupported_file')
                segment, media_time, rate, fraction = struct.unpack_from('>Qqhh' if version else '>Iihh', data, elst.start + 8)
                if media_time < 0 or rate != 1 or fraction:
                    raise MediaError('unsupported_file')
                reader.bound(segment, movie_scale)
                reader.bound(media_time, track.scale)
                segment = segment or track_duration
                if segment >= 1 << (64 if version else 32):
                    raise MediaError('unsupported_file')
                edited = _atom(b'elst', bytes([version]) + b'\0' * 3 + struct.pack('>I', 1) + struct.pack('>Qqhh' if version else '>Iihh', segment, media_time, 1, 0))
                contents.extend(_atom(b'edts', edited))
                movie_duration = max(movie_duration, segment)
            else:
                contents.extend(reader.raw(box))
        rebuilt.append(_atom(b'trak', contents))
    struct.pack_into('>I', payload, len(ftyp_bytes), len(payload) - len(ftyp_bytes))
    payload.extend(_atom(b'moov', reader.duration(mvhd, movie_duration) + b''.join(rebuilt)))
    if len(payload) > MAX_FILE_BYTES:
        raise MediaError('invalid_file')
    result = bytes(payload)
    inspect_mp4(result)
    return result
