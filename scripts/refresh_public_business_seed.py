"""Import an explicitly downloaded MHLW CSV and EDINET code ZIP, without network.

Only current ordinary listed companies with exact normalized names and a
unique, independently confirmed corporate number are retained. Workplace
employment/contact details are discarded. Only separately reviewed independent
factual summaries are accepted; input prose is not automatically republished.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import csv
import io
import json
from pathlib import Path
import re
import sys
import time
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from company_business import normalize_name, official_identity
from company_public_business import (EDINET_CODES_URL, USE_BASIS, SOURCE_URL, TERMS_URL,
                                    summary_excerpt, validate_record)
from stock_search import StockSearch

JST = timezone(timedelta(hours=9))


def csv_rows(path, *, edinet=False):
    with zipfile.ZipFile(path) as archive:
        files = archive.infolist()
        if len(files) != 1 or not files[0].filename.lower().endswith('.csv') or files[0].file_size > 600_000_000:
            raise ValueError('invalid_public_archive')
        with archive.open(files[0]) as stream:
            reader = io.TextIOWrapper(stream, encoding='cp932', newline='')
            if edinet:
                next(reader)
            yield from csv.DictReader(reader)


def verified_edinet_identities(rows, companies):
    by_number = defaultdict(list)
    by_symbol = Counter()
    for row in rows:
        code = row.get('証券コード', '')
        if not re.fullmatch(r'[0-9][A-Z0-9]{3}0', code):
            continue
        company = companies.get(code[:4])
        number = row.get('提出者法人番号', '')
        if (not company or row.get('上場区分') != '上場'
                or normalize_name(row.get('提出者名')) != normalize_name(company['name'])
                or not re.fullmatch(r'[0-9]{13}', number)
                or not re.fullmatch(r'E[0-9]{5}', row.get('ＥＤＩＮＥＴコード', ''))):
            continue
        by_number[number].append(dict(company=company, edinet_code=row['ＥＤＩＮＥＴコード'],
                                      edinet_name=row['提出者名']))
        by_symbol[company['symbol']] += 1
    return {number: matches[0] for number, matches in by_number.items()
            if len(matches) == 1 and by_symbol[matches[0]['company']['symbol']] == 1}


def build_seed(rows, identities, *, source_day, fetched_at, summaries=None, now=None):
    now = fetched_at if now is None else now
    if date.fromisoformat(source_day).isoformat() != source_day:
        raise ValueError('invalid_source_date')
    stats, accepted, duplicates = Counter(), {}, set()
    today = datetime.fromtimestamp(now, JST).date().isoformat()
    for row in rows:
        stats['source_rows'] += 1
        number = row.get('法人番号', '')
        match = identities.get(number)
        if not match:
            continue
        company = match['company']
        code = row.get('証券コード', '').strip()
        if normalize_name(row.get('企業名')) != normalize_name(company['name']):
            stats['corporate_name_mismatch'] += 1
            continue
        if code and code != company['code']:
            stats['source_code_mismatch'] += 1
            continue
        raw_summary = summary_excerpt(row.get('事業概要'))
        if not raw_summary:
            stats['missing_or_placeholder_summary'] += 1
            continue
        symbol = company['symbol']
        text = summaries.get(symbol) if isinstance(summaries, dict) else None
        if (not isinstance(text, str) or not 0 < len(text) <= 400
                or summary_excerpt(text) != text
                or len(text) > 30 and text == raw_summary):
            stats['independent_summary_not_provided'] += 1
            continue
        updated = row.get('更新日時', '')
        # Source times have no timezone. Keep only the explicitly supplied day;
        # this is the enterprise listing update, not the business-field update.
        record_day = (updated[:10] if isinstance(updated, str)
                      and re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', updated) else None)
        candidate = dict(symbol=symbol, identity=official_identity(symbol, company),
            proof=dict(code=company['code'], edinet_code=match['edinet_code'],
                       edinet_name=match['edinet_name'], corporate_number=number,
                       edinet_corporate_number=number, source_name=row['企業名'],
                       source_security_code=code),
            text=text, source_url=SOURCE_URL, terms_url=TERMS_URL, use_basis=USE_BASIS,
            source_updated_on=source_day, source_record_updated_on=record_day,
            identity_checked_on=today, fetched_at=fetched_at)
        if validate_record(candidate, company, now=now) is None:
            stats['invalid_summary_record'] += 1
            continue
        if symbol in accepted or symbol in duplicates:
            accepted.pop(symbol, None)
            duplicates.add(symbol)
            continue
        accepted[symbol] = candidate
    stats['ambiguous_duplicate_companies'] = len(duplicates)
    stats['verified_business_summaries'] = len(accepted)
    stats['verified_regional_summaries'] = sum(key.endswith('.JP') for key in accepted)
    return dict(schema_version=1, generated_at=datetime.fromtimestamp(now, JST).isoformat(),
                source_url=SOURCE_URL, terms_url=TERMS_URL, use_basis=USE_BASIS,
                source_updated_on=source_day, statistics=dict(stats),
                items=[accepted[key] for key in sorted(accepted)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workplace-zip', type=Path, required=True)
    parser.add_argument('--edinet-zip', type=Path, required=True)
    parser.add_argument('--source-date', required=True)
    parser.add_argument('--fetched-at', type=float, required=True,
                        help='Observed download-completion Unix time, not the import time')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--summaries', type=Path, required=True,
                        help='Separately reviewed independent descriptions; never raw CSV prose')
    parser.add_argument('--existing-wikidata-seed', type=Path)
    parser.add_argument('--existing-editorial', type=Path)
    args = parser.parse_args()
    catalogue = StockSearch(runtime_path=None)
    companies = {row['code']: catalogue.company(row['code']) for row in catalogue.all_items()['items']}
    identities = verified_edinet_identities(csv_rows(args.edinet_zip, edinet=True), companies)
    summaries = {}
    ambiguous = set()
    for row in json.loads(args.summaries.read_text(encoding='utf-8')).get('items', []):
        key = row.get('symbol')
        if key in summaries or key in ambiguous:
            summaries.pop(key, None); ambiguous.add(key)
        else:
            summaries[key] = row.get('text')
    result = build_seed(csv_rows(args.workplace_zip), identities,
                        source_day=args.source_date, fetched_at=args.fetched_at,
                        summaries=summaries, now=time.time())
    preserved = set()
    if args.existing_wikidata_seed:
        document = json.loads(args.existing_wikidata_seed.read_text(encoding='utf-8'))
        generic = {'日本の企業', '日本の会社', '日本の株式会社', '株式会社'}
        preserved.update(row['symbol'] for row in document.get('items', [])
                         if row.get('facts', {}).get('description')
                         and row['facts']['description'] not in generic)
    if args.existing_editorial:
        document = json.loads(args.existing_editorial.read_text(encoding='utf-8'))
        preserved.update(row['symbol'] for row in document.get('items', []) if row.get('business'))
    if preserved:
        total = len(result['items'])
        result['items'] = [row for row in result['items'] if row['symbol'] not in preserved]
        result['statistics']['already_described_preserved'] = total - len(result['items'])
        result['statistics']['additional_business_summaries'] = len(result['items'])
        result['statistics']['additional_regional_summaries'] = sum(row['symbol'].endswith('.JP') for row in result['items'])
    result['identity_source_url'] = EDINET_CODES_URL
    result['source_zip_sha256'] = sha256(args.workplace_zip.read_bytes()).hexdigest()
    result['identity_zip_sha256'] = sha256(args.edinet_zip.read_bytes()).hexdigest()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(args.output.name + '.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(args.output)
    print(json.dumps(result['statistics'], ensure_ascii=False))


if __name__ == '__main__':
    main()
