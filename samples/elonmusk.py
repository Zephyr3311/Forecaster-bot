import re
import json
from datetime import datetime, timezone
import pytz

ZoneInfo = pytz.timezone

# Configuration 
CSV_FILE_PATH = 'elonmusk.csv'
JSON_FILE_PATH = 'elonmusk.json'
START_YEAR = 2024

# Timezone mapping
TIMEZONE_MAP = {
    "EDT": "America/New_York", "EST": "America/New_York",
    "CDT": "America/Chicago", "CST": "America/Chicago",
    "MDT": "America/Denver", "MST": "America/Denver",
    "PDT": "America/Los_Angeles", "PST": "America/Los_Angeles",
}

def parse_date(date_str, last_dt_obj, current_year):
    """Parse date string and convert to UTC ISO format."""
    if not date_str or not isinstance(date_str, str):
        return None, last_dt_obj, current_year

    date_str = date_str.strip().strip('"')
    
    # Validate with regex
    match = re.match(r"^(\w{3}\s+\d{1,2}),?\s+(\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM))\s+(\w+)$", date_str)
    if not match:
        return None, last_dt_obj, current_year
    
    date_part, time_part, tz_abbr = match.groups()
    tz_abbr = tz_abbr.upper()
    
    try:
        # Parse with explicit year
        dt_str = f"{date_part} {current_year} {time_part}"
        dt_obj = datetime.strptime(dt_str, "%b %d %Y %I:%M:%S %p")
        
        # Check for year rollover
        if last_dt_obj and (dt_obj.month < last_dt_obj.month or 
                           (dt_obj.month == last_dt_obj.month and dt_obj.day < last_dt_obj.day)):
            dt_obj = dt_obj.replace(year=current_year + 1)
            current_year += 1
        
        # Apply timezone - FIX: Use pytz properly
        iana_tz = TIMEZONE_MAP.get(tz_abbr)
        if not iana_tz:
            return None, dt_obj, current_year
            
        # Correctly localize the naive datetime
        tz = ZoneInfo(iana_tz)
        dt_aware = tz.localize(dt_obj)
        dt_utc = dt_aware.astimezone(timezone.utc)
        
        return dt_utc.isoformat(), dt_obj, current_year
    except Exception as e:
        print(f"Date parse error: {e} for {date_str}")
        return None, last_dt_obj, current_year

def parse_csv(file_path):
    """Custom parser for handling multi-line CSV."""
    records = []
    record = None
    in_text = False
    
    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        f.readline()  # Skip header
        
        for line in f:
            line = line.strip()
            if not line:
                continue
                
            # Start of new record
            if not in_text and re.match(r'^\d+,"', line):
                if record:
                    records.append(record)
                
                id_match = re.match(r'^(\d+),"(.*)', line)
                if id_match:
                    tweet_id, rest = id_match.groups()
                    record = {'id': tweet_id, 'text': '', 'created_at': ''}
                    
                    # Check if record is complete on this line
                    text_end = rest.rfind('","')
                    if text_end != -1:
                        record['text'] = rest[:text_end]
                        record['created_at'] = rest[text_end+3:].strip('"')
                        in_text = False
                    else:
                        record['text'] = rest
                        in_text = True
            
            # Continuation of text field
            elif in_text:
                # Check for end of text field
                if '","' in line:
                    end_pos = line.rfind('","')
                    record['text'] += '\n' + line[:end_pos]
                    record['created_at'] = line[end_pos+3:].strip('"')
                    in_text = False
                elif line.endswith('"'):
                    record['text'] += '\n' + line.rstrip('"')
                    in_text = False
                else:
                    record['text'] += '\n' + line
    
    if record:
        records.append(record)
    
    return records

def convert_to_json(csv_path, json_path):
    processed_data = []
    last_dt_obj = None
    current_year = START_YEAR
    records_processed = 0
    records_date_failed = 0
    
    print(f"Starting conversion of {csv_path}...")
    
    try:
        records = parse_csv(csv_path)
        total = len(records)
        print(f"Found {total} records")
        
        for idx, record in enumerate(records, 1):
            records_processed += 1
            if records_processed % 1000 == 0:
                print(f"Processing record {records_processed}/{total}...")
            
            tweet_id = record.get('id', '').strip()
            tweet_text = record.get('text', '').strip()
            created_at = record.get('created_at', '').strip()
            
            output = {
                'id': tweet_id, 
                'text': tweet_text,
                'created_at_raw': created_at  # Always include the original date string
            }
            
            # Parse date
            date_iso, new_dt_obj, new_year = parse_date(created_at, last_dt_obj, current_year)
            
            if date_iso:
                output['created_at_utc'] = date_iso
                last_dt_obj = new_dt_obj
                current_year = new_year
            else:
                records_date_failed += 1
                
                if new_dt_obj:
                    last_dt_obj = new_dt_obj
                    current_year = new_year
            
            processed_data.append(output)
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        return
    
    # Write JSON output
    try:
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(processed_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error writing JSON: {e}")

convert_to_json(CSV_FILE_PATH, JSON_FILE_PATH)