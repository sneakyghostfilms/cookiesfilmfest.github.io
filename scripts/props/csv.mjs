export function parseCsv(text) {
  const source = text.startsWith('﻿') ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;
  let line = 1;
  const endField = () => {
    row.push(field);
    field = '';
    closed = false;
  };
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char !== '"') {
        if (char === '\n') line += 1;
        field += char;
      } else if (source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = false;
        closed = true;
      }
      continue;
    }
    if (char === ',') {
      endField();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      endField();
      rows.push(row);
      row = [];
      line += 1;
    } else if (closed) {
      throw new Error(`CSV line ${line}: text after a closing quote`);
    } else if (char === '"') {
      if (field !== '') throw new Error(`CSV line ${line}: a quote inside an unquoted field`);
      quoted = true;
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error(`CSV line ${line}: a quoted field is never closed`);
  if (field !== '' || closed || row.length) {
    endField();
    rows.push(row);
  }
  return rows;
}
