"""Write JSON to a staging file without materializing the complete encoding."""
import json


class JsonSizeLimitError(ValueError):
    """The encoded JSON would exceed its existing byte limit."""


def dump_bounded_json(value, binary_file, *, max_bytes, **json_options):
    """Write at most ``max_bytes`` UTF-8 bytes, or reject the staged output.

    The caller owns atomic publication and disposal of a failed staging file.
    JSONEncoder supplies the same representation as json.dumps with these
    options; splitting its chunks does not change the bytes written.
    """
    if type(max_bytes) is not int or max_bytes < 0:
        raise ValueError('invalid JSON byte limit')
    written = 0
    for chunk in json.JSONEncoder(**json_options).iterencode(value):
        # A single string value can be a large encoder chunk. Avoid creating
        # another complete bytes copy of that chunk just to measure its size.
        for start in range(0, len(chunk), 16_384):
            encoded = chunk[start:start + 16_384].encode('utf-8')
            if len(encoded) > max_bytes - written:
                raise JsonSizeLimitError('JSON byte limit exceeded')
            if binary_file.write(encoded) != len(encoded):
                raise OSError('incomplete JSON write')
            written += len(encoded)
    return written
