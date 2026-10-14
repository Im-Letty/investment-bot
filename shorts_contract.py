"""Shared server contract for logged-in Shorts authors; no authentication setup."""

from dataclasses import dataclass
import unicodedata
import uuid
import re
from urllib.parse import parse_qs, urlsplit


TOPICS = frozenset((
    '#経済入門', '#投資', '#マーケット', '#企業', '#家計・節約', '#税金',
    '#副業・お金', '#年金・老後', '#不動産', '#暗号資産', '#経済ニュース',
    '#世界経済', '#経済史', '#行動経済学', '#テクノロジーと経済', '#用語解説',
))


class SubmissionError(ValueError):
    def __init__(self, reason):
        # Reasons are fixed strings so remote errors cannot disclose tokens.
        self.reason = reason
        super().__init__(reason)


@dataclass(frozen=True)
class EditorialMetadata:
    request_id: str
    title: str
    caption: str
    topic: str


def verified_login_owner(auth_user):
    """Reject anonymous/missing identity after authoritative Auth verification.

    Supabase anonymous users also carry authenticated role/UUIDs. They are not
    the later logged-in account users authorised by the owner's instruction.
    Missing/ambiguous anonymous status fails closed until login integration.
    """
    if not isinstance(auth_user, dict) or auth_user.get('is_anonymous') is not False:
        raise SubmissionError('login_required')
    try:
        value = auth_user['id']
        if not isinstance(value, str):
            raise ValueError('invalid id')
        owner = uuid.UUID(value)
        if owner.int == 0:
            raise ValueError('invalid id')
        return str(owner)
    except (KeyError, ValueError, AttributeError, TypeError):
        raise SubmissionError('login_required') from None


def _text(value, limit, *, optional=False):
    if not isinstance(value, str):
        raise SubmissionError('invalid_metadata')
    # Keep ordinary newlines while excluding invisible command/control data.
    if any(unicodedata.category(c) in ('Cc', 'Cs') and c not in '\n\t' for c in value):
        raise SubmissionError('invalid_metadata')
    value = value.strip()
    if len(value) > limit or (not optional and not value):
        raise SubmissionError('invalid_metadata')
    return value


def editorial_metadata(data):
    """Validate only common fields, without choosing URL or binary handling.

    Reject injected ownership/publication/storage fields instead of allowing
    future adapters to accidentally pass them into a privileged repository.
    Input-provider fields must be validated by a later, separately chosen
    adapter, then removed before calling this function.
    """
    allowed = frozenset(('request_id', 'title', 'caption', 'topic'))
    if not isinstance(data, dict) or set(data) - allowed:
        raise SubmissionError('invalid_request')
    try:
        raw_id = data['request_id']
        if not isinstance(raw_id, str):
            raise ValueError('invalid request id')
        request_id = uuid.UUID(raw_id)
        if request_id.int == 0:
            raise ValueError('invalid request id')
    except (KeyError, ValueError, AttributeError, TypeError):
        raise SubmissionError('invalid_request_id') from None
    title = _text(data.get('title'), 120)
    caption = _text(data.get('caption', ''), 280, optional=True)
    topic = data.get('topic')
    if not isinstance(topic, str) or topic not in TOPICS:
        raise SubmissionError('invalid_topic')
    return EditorialMetadata(str(request_id), title, caption, topic)


def youtube_video_id(value):
    """Extract a recognised HTTPS URL's id; never follow/fetch the URL."""
    if not isinstance(value, str):
        raise SubmissionError('invalid_url')
    value = value.strip()
    if not value or len(value) > 2048 or any(ord(c) <= 32 or ord(c) == 127 for c in value):
        raise SubmissionError('invalid_url')
    try:
        parsed = urlsplit(value)
        if parsed.scheme != 'https' or parsed.netloc.lower() not in (
                'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'):
            raise ValueError('unsupported provider')
        if parsed.netloc.lower() == 'youtu.be':
            candidate = parsed.path[1:] if parsed.path.startswith('/') else ''
        elif parsed.path.startswith('/shorts/'):
            candidate = parsed.path[len('/shorts/'):]
        elif parsed.path == '/watch':
            ids = parse_qs(parsed.query, keep_blank_values=True).get('v', [])
            if len(ids) != 1:
                raise ValueError('ambiguous id')
            candidate = ids[0]
        else:
            raise ValueError('unsupported path')
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}', candidate):
            raise ValueError('invalid id')
        return candidate
    except (ValueError, TypeError):
        raise SubmissionError('invalid_url') from None
