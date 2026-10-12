"""Compile reviewed fiscal PER facts offline, without exporting research prose.

Every input and existing row must pass the current same-company validator before
any file is replaced. The ordinary official catalogue is read only from disk.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from company_year_per import KIND, SEED_PATH, USE_BASIS, validate_year_per
from stock_search import StockSearch

MAX_BYTES = 12_000_000
MAX_ITEMS = 8192
JST = timezone(timedelta(hours=9))
ROW_FIELDS = frozenset(('symbol', 'identity', 'kind', 'use_basis', 'latest_filing_guaranteed',
                       'status', 'value', 'reason', 'unit', 'basis', 'accounting_standard',
                       'fiscal_period', 'price_basis', 'price_reference_date', 'source_url',
                       'source_title', 'filed_on', 'checked_on', 'fetched_at', 'pdf_sha256', 'proof'))
PROOF_FIELDS = frozenset(('code', 'corporate_number', 'current_corporate_number', 'edinet_code',
                         'current_edinet_code', 'source_company_name', 'filing_company_name',
                         'official_code_match', 'current_company_name_match', 'doc_id', 'reviewed',
                         'review_method', 'fiscal_period_verified', 'accounting_standard_verified',
                         'ratio_row_verified', 'annual_report_verified', 'source_page', 'basis',
                         'accounting_standard', 'standalone_scope_verified', 'latest_column_end',
                         'price_basis_evidence_kind', 'source_ratio_text', 'source_eps_text',
                         'source_eps_label', 'eps_row_verified', 'not_presented_verified',
                         'loss_eps_verified', 'zero_eps_verified'))
IDENTITY_FIELDS = frozenset(('symbol', 'code', 'name', 'exchange', 'exchange_id', 'listings'))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_json_key')
        result[key] = value
    return result


def _reject_constant(_value):
    raise ValueError('nonfinite_json_number')


def read_document(path):
    path = Path(path)
    if path.stat().st_size > MAX_BYTES:
        raise ValueError('review_document_too_large')
    document = json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=_unique_object,
                          parse_constant=_reject_constant)
    if (not isinstance(document, dict) or type(document.get('schema_version')) is not int
            or document['schema_version'] != 1 or not isinstance(document.get('items'), list)
            or len(document['items']) > MAX_ITEMS):
        raise ValueError('invalid_review_document')
    return document


def public_row(raw, catalogue, *, now):
    if not isinstance(raw, dict) or not isinstance(raw.get('symbol'), str):
        raise ValueError('invalid_review_identity')
    if not isinstance(raw.get('identity'), dict) or not isinstance(raw.get('proof'), dict):
        raise ValueError('invalid_review_proof')
    row = {key: deepcopy(value) for key, value in raw.items() if key in ROW_FIELDS}
    row['identity'] = {key: deepcopy(value) for key, value in raw['identity'].items()
                       if key in IDENTITY_FIELDS}
    listings = row['identity'].get('listings')
    if listings is not None:
        if not isinstance(listings, list) or len(listings) > 3 or not all(isinstance(item, dict) for item in listings):
            raise ValueError('invalid_review_identity')
        row['identity']['listings'] = [{key: deepcopy(value) for key, value in item.items()
                                       if key in ('exchange', 'exchange_id')} for item in listings]
    row['proof'] = {key: deepcopy(value) for key, value in raw['proof'].items() if key in PROOF_FIELDS}
    for field, limit in (('source_eps_label', 160), ('source_ratio_text', 40), ('source_eps_text', 40)):
        value = row['proof'].get(field)
        if value is not None and (not isinstance(value, str) or len(value) > limit):
            raise ValueError('invalid_review_proof_text')
    title = row.get('source_title')
    if title is not None and (not isinstance(title, str) or not 0 < len(title) <= 160):
        raise ValueError('invalid_review_source_title')
    company = catalogue.company(row['symbol'].split('.')[0])
    if validate_year_per(row, company, now=now) is None:
        raise ValueError('invalid_reviewed_year_per')
    return row


def _validated_items(document, catalogue, *, now):
    if (not isinstance(document, dict) or type(document.get('schema_version')) is not int
            or document['schema_version'] != 1 or not isinstance(document.get('items'), list)
            or len(document['items']) > MAX_ITEMS):
        raise ValueError('invalid_review_document')
    items = {}
    for raw in document['items']:
        row = public_row(raw, catalogue, now=now)
        if row['symbol'] in items:
            raise ValueError('duplicate_reviewed_company')
        items[row['symbol']] = row
    return items


def _choose(next_row, old_row):
    """A fresh review never makes an older fiscal period or filing the latest."""
    next_period = (next_row['fiscal_period']['end'], next_row['filed_on'])
    old_period = (old_row['fiscal_period']['end'], old_row['filed_on'])
    if next_period < old_period:
        return old_row
    if next_row == old_row:
        return old_row
    next_check = (next_row['checked_on'], next_row['fetched_at'])
    old_check = (old_row['checked_on'], old_row['fetched_at'])
    same_document = next_row['proof']['doc_id'] == old_row['proof']['doc_id']
    if same_document:
        # Same-document corrections require renewed verification; do not bump
        # acquisition dates just because the compiler was run again.
        renewed = (next_row['checked_on'] >= old_row['checked_on']
                   and next_row['fetched_at'] >= old_row['fetched_at']
                   and next_check != old_check)
        if not renewed:
            if next_check >= old_check:
                raise ValueError('same_document_verification_regressed')
            return old_row
    if next_period > old_period:
        return next_row
    return next_row if next_check > old_check else old_row


def compile_reviews(documents, catalogue, *, existing=None, now=None):
    now = time.time() if now is None else now
    incoming = {}
    for document in documents:
        for symbol, row in _validated_items(document, catalogue, now=now).items():
            if symbol in incoming:
                raise ValueError('duplicate_reviewed_company')
            incoming[symbol] = row
    if not incoming or len(incoming) > MAX_ITEMS:
        raise ValueError('empty_or_excessive_review_input')
    items = _validated_items(existing, catalogue, now=now) if existing is not None else {}
    accepted, older = 0, 0
    for symbol, row in incoming.items():
        if symbol not in items:
            items[symbol] = row
            accepted += 1
            continue
        chosen = _choose(row, items[symbol])
        if chosen != items[symbol]:
            accepted += 1
        else:
            older += 1
        items[symbol] = chosen
    if len(items) > MAX_ITEMS:
        raise ValueError('excessive_seed_items')
    document = {'schema_version': 1, 'kind': KIND, 'use_basis': USE_BASIS,
                'source_documents_published': False, 'raw_source_prose_published': False,
                'items': [items[symbol] for symbol in sorted(items)]}
    report = {'reviewed_input_items': len(incoming), 'accepted_new_or_updated': accepted,
              'retained_same_or_newer': older, 'seed_items': len(items),
              'source_requests': 0, 'raw_source_prose_published': False}
    return document, report


def atomic_write(path, document):
    path = Path(path)
    payload = json.dumps(document, ensure_ascii=False, indent=2, allow_nan=False)+'\n'
    if len(payload.encode('utf-8')) > MAX_BYTES:
        raise ValueError('seed_document_too_large')
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.year-per-seed-', suffix='.tmp', dir=path.parent)
    try:
        mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def refresh_seed(reviews, output=SEED_PATH, *, merge_existing=False, catalogue=None, now=None):
    documents = [read_document(path) for path in reviews]
    output = Path(output)
    existing = read_document(output) if merge_existing and output.exists() else None
    catalogue = catalogue if catalogue is not None else StockSearch(runtime_path=None)
    document, report = compile_reviews(documents, catalogue, existing=existing, now=now)
    # A repeated or older result leaves a canonical existing seed untouched.
    if existing is not None and document.get('items') == existing.get('items'):
        report['output_changed'] = False
        return report
    atomic_write(output, document)
    report['output_changed'] = True
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reviews', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path, default=SEED_PATH)
    parser.add_argument('--merge-existing', action='store_true')
    args = parser.parse_args()
    try:
        report = refresh_seed(args.reviews, args.output, merge_existing=args.merge_existing)
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        parser.exit(2, 'Reviewed PER compilation failed; the existing seed was not replaced.\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
