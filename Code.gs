const SHEET_NAME = 'data';
const MONTHLY_SHEET_NAME = 'monthly';
const MONTHLY_HEADERS = [
  'member_id',
  'year_month',
  'one_on_one_count',
  'monthly_report_count',
  'plus_customer',
  'plus_blog',
  'plus_interview',
  'memo',
  'created_at',
  'updated_at'
];

function doGet(e) {
  const key = e && e.parameter ? e.parameter.key : '';

  if (key === 'kadou_monthly_v1') {
    const sheet = getOrCreateSheet_(MONTHLY_SHEET_NAME);
    ensureMonthlyHeader_(sheet);
    const records = readMonthlyRecords_(sheet);

    return ContentService
      .createTextOutput(JSON.stringify({
        key: key,
        value: JSON.stringify(records),
        updated_at: getMonthlyUpdatedAt_(records)
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ key: key, value: null, updated_at: null }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const data = sheet.getDataRange().getValues();

  for (const row of data) {
    if (row[0] === key) {
      return ContentService
        .createTextOutput(JSON.stringify({
          key: row[0],
          value: row[1],
          updated_at: row[2]
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService
    .createTextOutput(JSON.stringify({ key: key, value: null, updated_at: null }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('missing post body');
    }

    const payload = JSON.parse(e.postData.contents);
    if (!payload || !payload.key) {
      throw new Error('missing key');
    }
    if (payload.value === undefined || payload.value === null) {
      throw new Error('missing value');
    }

    if (payload.key === 'kadou_monthly_v1') {
      const incomingRecords = JSON.parse(payload.value);
      if (!Array.isArray(incomingRecords)) {
        throw new Error('monthly value must be an array');
      }

      const sheet = getOrCreateSheet_(MONTHLY_SHEET_NAME);
      ensureMonthlyHeader_(sheet);

      const existingRecords = readMonthlyRecords_(sheet);
      const recordMap = new Map();

      existingRecords.forEach(function(record) {
        recordMap.set(buildMonthlyKey_(record.member_id, record.year_month), record);
      });

      let skippedCount = 0;
      incomingRecords.forEach(function(record) {
        const normalized = normalizeMonthlyRecord_(record);
        if (!normalized) {
          skippedCount += 1;
          return;
        }
        recordMap.set(buildMonthlyKey_(normalized.member_id, normalized.year_month), normalized);
      });

      if (skippedCount > 0) {
        console.log('monthly skipped invalid records: ' + skippedCount);
      }

      const mergedRecords = Array.from(recordMap.values()).sort(function(a, b) {
        if (a.year_month !== b.year_month) {
          return String(a.year_month).localeCompare(String(b.year_month));
        }
        return String(a.member_id).localeCompare(String(b.member_id));
      });

      writeMonthlyRecords_(sheet, mergedRecords);

      return ContentService
        .createTextOutput(JSON.stringify({
          ok: true,
          key: payload.key,
          saved_count: mergedRecords.length
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) {
      throw new Error('data sheet not found');
    }
    const data = sheet.getDataRange().getValues();
    const now = new Date().toISOString();
    const value = payload.value || '';

    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === payload.key) {
        sheet.getRange(i + 1, 2).setValue(value);
        sheet.getRange(i + 1, 3).setValue(now);

        const savedValue = String(sheet.getRange(i + 1, 2).getValue() || '');
        if (savedValue !== String(value)) {
          return ContentService
            .createTextOutput(JSON.stringify({
              ok: false,
              error: 'saved value mismatch',
              key: payload.key,
              expected_length: String(value).length,
              saved_length: savedValue.length
            }))
            .setMimeType(ContentService.MimeType.JSON);
        }

        return ContentService
          .createTextOutput(JSON.stringify({
            ok: true,
            key: payload.key,
            saved_length: savedValue.length
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    sheet.appendRow([payload.key, value, now]);

    const lastRow = sheet.getLastRow();
    const savedValue = String(sheet.getRange(lastRow, 2).getValue() || '');
    if (savedValue !== String(value)) {
      return ContentService
        .createTextOutput(JSON.stringify({
          ok: false,
          error: 'saved value mismatch after append',
          key: payload.key,
          expected_length: String(value).length,
          saved_length: savedValue.length
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        ok: true,
        key: payload.key,
        saved_length: savedValue.length
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({
        ok: false,
        error: String(err)
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getOrCreateSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  return sheet;
}

function ensureMonthlyHeader_(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, MONTHLY_HEADERS.length);
  const currentHeader = headerRange.getValues()[0];
  let needsUpdate = false;

  for (let i = 0; i < MONTHLY_HEADERS.length; i++) {
    if (String(currentHeader[i] || '') !== MONTHLY_HEADERS[i]) {
      needsUpdate = true;
      break;
    }
  }

  if (needsUpdate) {
    headerRange.setValues([MONTHLY_HEADERS]);
  }
}

function buildMonthlyKey_(memberId, yearMonth) {
  return String(memberId) + '__' + String(yearMonth);
}

function normalizeMonthlyRecord_(record) {
  if (!record) {
    return null;
  }

  const memberId = String(record.member_id || '').trim();
  const yearMonth = normalizeYearMonth_(record.year_month);
  if (!memberId || !yearMonth) {
    return null;
  }

  return {
    member_id: memberId,
    year_month: yearMonth,
    one_on_one_count: toNumber_(record.one_on_one_count),
    monthly_report_count: toNumber_(record.monthly_report_count),
    plus_customer: toNumber_(record.plus_customer),
    plus_blog: toNumber_(record.plus_blog),
    plus_interview: toNumber_(record.plus_interview),
    memo: String(record.memo || ''),
    created_at: normalizeDateField_(record.created_at),
    updated_at: normalizeDateField_(record.updated_at)
  };
}

function readMonthlyRecords_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, MONTHLY_HEADERS.length).getValues();
  const records = [];
  let skippedCount = 0;

  values.forEach(function(row) {
    const normalized = normalizeMonthlyRecord_({
      member_id: row[0],
      year_month: row[1],
      one_on_one_count: row[2],
      monthly_report_count: row[3],
      plus_customer: row[4],
      plus_blog: row[5],
      plus_interview: row[6],
      memo: row[7],
      created_at: row[8],
      updated_at: row[9]
    });

    if (!normalized) {
      skippedCount += 1;
      return;
    }

    records.push({
      id: buildMonthlyKey_(normalized.member_id, normalized.year_month),
      member_id: normalized.member_id,
      year_month: normalized.year_month,
      one_on_one_count: normalized.one_on_one_count,
      monthly_report_count: normalized.monthly_report_count,
      plus_customer: normalized.plus_customer,
      plus_blog: normalized.plus_blog,
      plus_interview: normalized.plus_interview,
      memo: normalized.memo,
      created_at: normalized.created_at,
      updated_at: normalized.updated_at
    });
  });

  if (skippedCount > 0) {
    console.log('monthly skipped invalid rows: ' + skippedCount);
  }

  return records;
}

function writeMonthlyRecords_(sheet, records) {
  ensureMonthlyHeader_(sheet);

  const normalizedRecords = [];
  let skippedCount = 0;

  records.forEach(function(record) {
    const normalized = normalizeMonthlyRecord_(record);
    if (!normalized) {
      skippedCount += 1;
      return;
    }
    normalizedRecords.push(normalized);
  });

  if (skippedCount > 0) {
    console.log('monthly skipped invalid records before write: ' + skippedCount);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, MONTHLY_HEADERS.length).clearContent();
  }

  if (normalizedRecords.length === 0) {
    return;
  }

  const values = normalizedRecords.map(function(record) {
    return [
      record.member_id,
      record.year_month,
      record.one_on_one_count,
      record.monthly_report_count,
      record.plus_customer,
      record.plus_blog,
      record.plus_interview,
      record.memo,
      record.created_at,
      record.updated_at
    ];
  });

  sheet.getRange(2, 1, values.length, MONTHLY_HEADERS.length).setValues(values);
}

function getMonthlyUpdatedAt_(records) {
  let latest = '';

  records.forEach(function(record) {
    const updatedAt = String(record.updated_at || '');
    if (!updatedAt) {
      return;
    }
    if (!latest || updatedAt > latest) {
      latest = updatedAt;
    }
  });

  return latest;
}

function toNumber_(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeYearMonth_(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM');
  }

  const text = String(value).trim();
  if (!text) {
    return '';
  }

  let match = text.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    return match[1] + '-' + match[2];
  }

  match = text.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (match) {
    return match[1] + '-' + match[2];
  }

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM');
  }

  return text;
}

function normalizeDateField_(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const text = String(value).trim();
  if (!text) {
    return '';
  }

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return match[1] + '-' + match[2] + '-' + match[3];
  }

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return text;
}
