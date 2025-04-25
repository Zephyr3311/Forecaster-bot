import re
import json
from datetime import datetime, timezone
import pytz
import os

script_dir = os.path.dirname(os.path.abspath(__file__))
CSV_FILE_PATH = os.path.join(script_dir, 'elonmusk.csv')
JSON_FILE_PATH = os.path.join(script_dir, 'elonmusk.json')
START_YEAR = 2024

TIMEZONE_MAP = {
    "EDT": "America/New_York", "EST": "America/New_York",
    "CDT": "America/Chicago", "CST": "America/Chicago",
    "MDT": "America/Denver", "MST": "America/Denver",
    "PDT": "America/Los_Angeles", "PST": "America/Los_Angeles",
}

def parse_date(date_str, last_dt_obj, current_year):
    if not date_str or not isinstance(date_str, str):
        return None, last_dt_obj, current_year

    date_str = date_str.strip().strip('"')
    match = re.match(r"^(\w{3}\s+\d{1,2}),?\s+(\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM))\s+(\w+)$", date_str)
    if not match:
        return None, last_dt_obj, current_year

    date_part, time_part, tz_abbr = match.groups()
    tz_abbr = tz_abbr.upper()

    try:
        dt_str = f"{date_part} {current_year} {time_part}"
        dt_obj = datetime.strptime(dt_str, "%b %d %Y %I:%M:%S %p")

        if last_dt_obj and (dt_obj.month < last_dt_obj.month or
                           (dt_obj.month == last_dt_obj.month and dt_obj.day < last_dt_obj.day)):
            dt_obj = dt_obj.replace(year=current_year + 1)
            current_year += 1

        iana_tz = TIMEZONE_MAP.get(tz_abbr)
        if not iana_tz:
            return None, dt_obj, current_year

        tz = pytz.timezone(iana_tz)
        dt_aware = tz.localize(dt_obj)
        dt_utc = dt_aware.astimezone(timezone.utc)

        return dt_utc.isoformat(), dt_obj, current_year
    except Exception:
        # print(f"Date parse error: {e} for {date_str}") # Keep silent as requested
        return None, last_dt_obj, current_year

def parse_csv(file_path):
    records = []
    record = None
    in_text = False

    try:
        with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
            f.readline() # Skip header

            for line in f:
                line = line.strip()
                if not line:
                    continue

                if not in_text and re.match(r'^\d+,"', line):
                    if record:
                        records.append(record)

                    id_match = re.match(r'^(\d+),"(.*)', line)
                    if id_match:
                        tweet_id, rest = id_match.groups()
                        record = {'id': tweet_id, 'text': '', 'created_at': ''}

                        text_end = rest.rfind('","')
                        if text_end != -1:
                            record['text'] = rest[:text_end].replace('""', '"')
                            record['created_at'] = rest[text_end+3:].strip('"')
                            in_text = False
                        else:
                            record['text'] = rest.replace('""', '"')
                            in_text = True

                elif in_text:
                    text_end = line.rfind('","')
                    if text_end != -1:
                        record['text'] += '\n' + line[:text_end].replace('""', '"')
                        record['created_at'] = line[text_end+3:].strip('"')
                        in_text = False
                    elif line.endswith('"'):
                         # Handle case where text ends with quote but no comma for date
                         record['text'] += '\n' + line[:-1].replace('""', '"')
                         in_text = False # Assume end of record if text ends, date might be missing
                    else:
                        record['text'] += '\n' + line.replace('""', '"')

        if record:
            records.append(record)
    except FileNotFoundError:
        print(f"Error: CSV file not found at {file_path}")
        return None
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return None

    return records

def convert_to_json(csv_path, json_path):
    processed_data = []
    last_dt_obj = None
    current_year = START_YEAR
    records_processed = 0
    records_date_failed = 0

    print(f"Attempting to read CSV from: {csv_path}")
    records = parse_csv(csv_path)

    if records is None:
        print("CSV parsing failed. Exiting.")
        return

    total = len(records)
    print(f"Found {total} records. Starting conversion...")

    try:
        for idx, record in enumerate(records, 1):
            records_processed += 1
            if records_processed % 5000 == 0: # Progress update frequency
                print(f"Processing record {records_processed}/{total}...")

            tweet_id = record.get('id', '').strip()
            tweet_text = record.get('text', '').strip()
            created_at = record.get('created_at', '').strip()

            output = {
                'id': tweet_id,
                'text': tweet_text,
                'created_at_raw': created_at
            }

            date_iso, new_dt_obj, new_year = parse_date(created_at, last_dt_obj, current_year)

            if date_iso:
                output['created_at_utc'] = date_iso
                last_dt_obj = new_dt_obj
                current_year = new_year
            else:
                records_date_failed += 1
                if new_dt_obj: # Still update last_dt_obj even if formatting failed
                    last_dt_obj = new_dt_obj
                    current_year = new_year

            processed_data.append(output)

    except Exception as e:
        print(f"Error during processing record {records_processed}: {e}")
        import traceback
        traceback.print_exc()
        return

    try:
        print(f"Writing JSON output to: {json_path}")
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(processed_data, f, indent=2, ensure_ascii=False)
        print(f"Conversion complete. Processed: {records_processed}, Date parse failed: {records_date_failed}")
    except Exception as e:
        print(f"Error writing JSON: {e}")

convert_to_json(CSV_FILE_PATH, JSON_FILE_PATH)