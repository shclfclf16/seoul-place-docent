"""Local full-input audit and lossless conversion verification; never fetches URLs."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import zipfile
from load_zip_bigquery import FILES, archive_sha256, header_check, iter_input, stream_jsonl, row_sha256


def audit(zf, manifest, digest, roundtrip=False):
    header_check(zf, manifest)
    result = {'archive_sha256': digest, 'scope': 'LOCAL_ALL_ROWS', 'files': {}}
    records, places, pairs = set(), set(), set()
    relations = Counter()
    links = []
    for kind in FILES:
        columns = manifest['files'][kind]['columns']
        stats = {'rows': 0, 'columns': len(columns), 'invalid_json': Counter(),
                 'blank': Counter(), 'statuses': {}, 'csv_sha256': ''}
        with zf.open(kind + '.csv') as raw:
            stats['csv_sha256'] = hashlib.file_digest(raw, 'sha256').hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            converted = Path(directory) / 'rows.jsonl'
            if roundtrip:
                stream_jsonl(zf, kind, manifest, digest, converted)
            with (converted.open(encoding='utf-8') if roundtrip else open(__file__, encoding='utf-8')) as check:
                for line_no, row in iter_input(zf, kind, columns):
                    stats['rows'] += 1
                    if roundtrip:
                        value = json.loads(next(check))
                        assert {key: value[key] for key in columns} == row, 'Lossy conversion'
                        assert value['_row_sha256'] == row_sha256(row)
                        assert value['_input_row_number'] == line_no
                        assert value['_batch_sha256'] == digest
                        assert value['_input_filename'] == kind + '.csv'
                    for key, value in row.items():
                        if not value.strip(): stats['blank'][key] += 1
                        if key.endswith('_json') and value:
                            try: json.loads(value)
                            except ValueError: stats['invalid_json'][key] += 1
                        if key.endswith(('_status', '_permission')) or key == 'record_type':
                            stats['statuses'].setdefault(key, Counter())[value] += 1
                    if kind in FILES[:4]:
                        identity = row['record_id']
                        if not identity or identity in records: raise ValueError('Blank/duplicate record ID')
                        records.add(identity)
                    elif kind == 'places':
                        identity = row['place_id']
                        if not identity or identity in places: raise ValueError('Blank/duplicate place ID')
                        places.add(identity)
                    else:
                        links.append((row['record_id'], row['place_id'], row['relation_type']))
                if roundtrip: assert check.read() == '', 'Extra converted rows'
        if stats['rows'] != manifest['files'][kind]['rows']: raise ValueError(f'{kind}: count mismatch')
        result['files'][kind] = stats
    blank_places = duplicates = missing_records = missing_places = 0
    for record, place, relation in links:
        relations[relation] += 1
        duplicates += (record, place) in pairs
        pairs.add((record, place))
        missing_records += record not in records
        missing_places += bool(place) and place not in places
        blank_places += not place
        if not place and relation != 'UNCERTAIN': raise ValueError('Blank place must stay uncertain')
    if missing_records or missing_places: raise ValueError('Dangling nonblank reference')
    result.update(records=len(records), places=len(places), links=len(links),
                  total_rows=sum(s['rows'] for s in result['files'].values()),
                  blank_place_ids=blank_places, duplicate_link_pairs=duplicates,
                  missing_record_refs=missing_records, missing_nonblank_place_refs=missing_places,
                  relation_counts=relations, full_roundtrip_verified=roundtrip)
    return result


def preserve(source, destination, digest):
    """Private byte-for-byte ZIP + CSV archive, outside public/data paths."""
    destination = destination.resolve()
    if any(p.lower() in {'public', 'data', '.git'} for p in destination.parts):
        raise ValueError('Choose a private archive directory outside served paths')
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / (digest + '.zip')
    if target.exists():
        if archive_sha256(target) != digest: raise ValueError('Existing archive differs')
    else:
        with source.open('rb') as src, target.open('xb') as dst: shutil.copyfileobj(src, dst)
    if archive_sha256(target) != digest: raise ValueError('Archive copy checksum mismatch')
    with zipfile.ZipFile(target) as zf:
        for kind in FILES:
            path = destination / (kind + '.csv')
            with zf.open(kind + '.csv') as src:
                expected = hashlib.file_digest(src, 'sha256').hexdigest()
            if not path.exists():
                with zf.open(kind + '.csv') as src, path.open('xb') as dst: shutil.copyfileobj(src, dst)
            if archive_sha256(path) != expected: raise ValueError('CSV archive checksum mismatch')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zip', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--preserve-dir', type=Path)
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name('schema_manifest.json').read_text('utf-8'))
    digest = archive_sha256(args.zip)
    if digest != manifest['archive_sha256']: raise ValueError('Unreviewed ZIP hash')
    with zipfile.ZipFile(args.zip) as zf: report = audit(zf, manifest, digest, roundtrip=True)
    if args.preserve_dir: preserve(args.zip, args.preserve_dir, digest)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'files'}, indent=2))


if __name__ == '__main__': main()
