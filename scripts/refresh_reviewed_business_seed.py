"""Offline merge of individually authored summaries and verified public reports.

Research text is never republished by this importer. Current-company proof,
original document hash/date, and independent author text are required.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from company_business import official_identity
from company_reviewed_business import SEED_PATH, USE_BASIS, report_document_id, validate_summary
from stock_search import StockSearch


def compile_summaries(authored, records, catalogue):
    sources = {row['symbol']: row for row in records if isinstance(row, dict) and isinstance(row.get('symbol'), str)}
    items, skipped, seen = [], [], set()
    for summary in authored:
        symbol = summary.get('symbol') if isinstance(summary, dict) else None
        if not isinstance(symbol, str) or symbol in seen:
            raise ValueError('Duplicate or invalid authored identity')
        seen.add(symbol)
        source = sources.get(symbol)
        company = catalogue.company(symbol.split('.')[0])
        if not source or source.get('status') != 'verified_filing_business_section' or not company:
            skipped.append({'symbol': symbol, 'reason': 'verified_source_missing'})
            continue
        proof = deepcopy(source.get('proof', {}))
        proof.update(code=company['code'], current_edinet_code=proof.get('edinet_code'),
                     current_corporate_number=proof.get('corporate_number'),
                     doc_id=report_document_id(source.get('source_url')))
        row = dict(symbol=symbol, identity=official_identity(symbol, company), source_kind='public_annual_report',
                   use_basis=USE_BASIS, text=summary.get('text'), proof=proof,
                   source_url=source.get('source_url'), filed_on=source.get('filed_on'),
                   checked_on=source.get('checked_on'), fetched_at=source.get('fetched_at'),
                   pdf_sha256=source.get('pdf_sha256'))
        if validate_summary(row, company) is None:
            skipped.append({'symbol': symbol, 'reason': 'current_identity_or_source_invalid'})
            continue
        original = ''.join(source.get('business_section', '').split())
        compact = ''.join(row['text'].split())
        if len(compact) >= 24 and any(compact[index:index+24] in original for index in range(len(compact)-23)):
            skipped.append({'symbol': symbol, 'reason': 'requires_independent_wording_review'})
            continue
        items.append(row)
    return items, skipped


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--summaries', type=Path, nargs='+', required=True)
    parser.add_argument('--output', type=Path, default=SEED_PATH)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--merge-existing', action='store_true')
    args = parser.parse_args()
    research = json.loads(args.sources.read_text())
    records = research.get('records', research) if isinstance(research, dict) else research
    records = list(records.values()) if isinstance(records, dict) else records
    authored = []
    for path in args.summaries:
        document = json.loads(path.read_text())
        authored.extend(document['items'])
    catalogue = StockSearch(runtime_path=None)
    items, skipped = compile_summaries(authored, records, catalogue)
    existing = {}
    if args.merge_existing and args.output.exists():
        for row in json.loads(args.output.read_text()).get('items', []):
            if validate_summary(row, catalogue.company(row['symbol'].split('.')[0])) is not None:
                existing[row['symbol']] = row
    for row in items:
        existing[row['symbol']] = row
    document = {'schema_version': 1, 'use_basis': USE_BASIS,
                'source_documents_published': False, 'items': sorted(existing.values(), key=lambda row: row['symbol'])}
    args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n')
    report = {'authored_input': len(authored), 'new_valid_items': len(items),
              'total_seed_items': len(document['items']), 'skipped': skipped,
              'raw_source_prose_published': False}
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
