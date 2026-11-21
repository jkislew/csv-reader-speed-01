// Fast drop-in replacement for csv-reader 1.0.0 (make.fun csv-reader-speed-01).
//
// run(input) returns exactly what the reference reader returns for {text, header}:
// {columns, rows, errors} under the broken-row policy the kit spells out. The
// reference builds every field one character at a time; this reader instead
// scans by index and cuts each field out of the source text with a single
// slice whenever the field needs no repair, so the common field costs one
// scan and one slice, and a quoted field jumps from quote to quote with
// indexOf instead of visiting every character. The unquoted scan is
// inlined into the record loop and each record's fields land in an array
// preallocated at the known width, so the dominant field type pays no
// call, no result object and no array growth. The rare repairs (a stray
// CR in an unquoted field, a CR inside quotes) fall back to segment
// assembly, which keeps the reference's answers — and its error order —
// byte for byte.
//
// Policy recap, as implemented below:
// - a U+FEFF at the very start is dropped;
// - a record ends at LF or CRLF; a line with no characters is no record;
// - outside quotes a CR not followed by LF is dropped (stray_cr);
// - a field opening with a quote runs to the next undoubled quote; "" inside
//   is one quote, and each CRLF or lone CR inside becomes one LF; text after
//   the closing quote up to the next comma or line break is appended as it
//   stands (quote_junk when anything was appended); a quote that never
//   closes is a literal character and the rest is re-read as unquoted
//   (unterminated_quote);
// - a quote inside an unquoted field is a literal character;
// - columns is the first record when header is true, else null; rows are
//   padded (short_row) or cut (long_row) to the first record's width;
// - every error is {code, line, row} with line the 1-based line its record
//   starts on and row its index in rows (null for the header), in the order
//   met, with a record's short_row / long_row last for that record.

// How a field ended.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // index of the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on, and its index in rows
  // (null while it is the header). Every error of the record reports these.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters starting at pos, on top of `initial`, up to
  // the next comma or line break. A CR not followed by LF is dropped with a
  // stray_cr error. Leaves pos just past the terminator and returns the
  // field value, how it ended, and how many characters were kept.
  function readUnquoted(initial) {
    let start = pos;
    let built = null; // assembled value once a stray CR splits the field
    let i = pos;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) { // ','
        const seg = text.slice(start, i);
        const value = built === null ? initial + seg : built + seg;
        pos = i + 1;
        return { value, ended: COMMA, added: value.length - initial.length };
      }
      if (c === 10) { // LF
        const seg = text.slice(start, i);
        const value = built === null ? initial + seg : built + seg;
        pos = i + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added: value.length - initial.length };
      }
      if (c === 13) { // CR
        if (i + 1 < n && text.charCodeAt(i + 1) === 10) { // CRLF
          const seg = text.slice(start, i);
          const value = built === null ? initial + seg : built + seg;
          pos = i + 2;
          line += 1;
          return { value, ended: LINE_BREAK, added: value.length - initial.length };
        }
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        const seg = text.slice(start, i);
        built = built === null ? initial + seg : built + seg;
        i += 1;
        start = i;
        continue;
      }
      i += 1;
    }
    const seg = text.slice(start, n);
    const value = built === null ? initial + seg : built + seg;
    pos = n;
    return { value, ended: END, added: value.length - initial.length };
  }

  // Reads a quoted field whose opening quote is at pos, the slow way:
  // character by character. readQuoted below uses it when a CR turns up
  // inside the quotes, where every CR or CRLF becomes an LF.
  function readQuotedSlow() {
    const open = pos;
    const openLine = line;
    let value = '';
    let scan = pos + 1;
    let segStart = scan;
    let closed = false;
    while (scan < n) {
      const c = text.charCodeAt(scan);
      if (c === 34) { // '"'
        if (scan + 1 < n && text.charCodeAt(scan + 1) === 34) {
          // A doubled quote inside the field is one quote.
          value += text.slice(segStart, scan) + '"';
          scan += 2;
          segStart = scan;
          continue;
        }
        value += text.slice(segStart, scan);
        scan += 1;
        closed = true;
        break;
      }
      if (c === 13) { // CR or CRLF inside quotes reads as one LF
        value += text.slice(segStart, scan) + '\n';
        line += 1;
        scan += scan + 1 < n && text.charCodeAt(scan + 1) === 10 ? 2 : 1;
        segStart = scan;
        continue;
      }
      if (c === 10) line += 1; // an LF inside quotes stays in the slice
      scan += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as an unquoted field.
      pos = open + 1;
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted('"');
    }
    pos = scan;
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break; stray CRs inside it report before the
    // quote_junk error, exactly as the reference orders them.
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Reads a quoted field whose opening quote is at pos: jumps from quote
  // to quote with indexOf and slices each clean segment out whole, which
  // is where most quoted fields (phrases holding commas) spend their
  // time. A segment holding a CR restarts the field on the slow reader,
  // since CRs inside quotes change both the value and the line count;
  // that is rare (multi-line notes). LFs inside a clean segment stay in
  // the slice and are counted for the line number.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let scan = pos + 1;
    let segStart = scan;
    while (true) {
      const q = text.indexOf('"', scan);
      if (q === -1) {
        // No closing quote anywhere: a literal quote, re-read unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      const seg = text.slice(segStart, q);
      if (seg.indexOf('\r') !== -1) {
        line = openLine;
        return readQuotedSlow();
      }
      let lf = seg.indexOf('\n');
      if (lf !== -1) {
        let cnt = 0;
        while (lf !== -1) {
          cnt += 1;
          lf = seg.indexOf('\n', lf + 1);
        }
        line += cnt;
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        // A doubled quote inside the field is one quote.
        value += seg + '"';
        scan = q + 2;
        segStart = scan;
        continue;
      }
      value += seg;
      pos = q + 1;
      break;
    }
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines left with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    // Fields are stored into an array preallocated at the known width
    // (once the first record has set it); it grows past that only for a
    // long row, and its length is trimmed back to the field count.
    const fields = width > 0 ? new Array(width) : [];
    let count = 0;
    let ended = COMMA;
    let quoted = false;
    while (ended === COMMA) {
      quoted = pos < n && text.charCodeAt(pos) === 34;
      let value;
      if (quoted) {
        const field = readQuoted();
        value = field.value;
        ended = field.ended;
      } else if (pos >= n) {
        value = '';
        ended = END;
      } else {
        // The unquoted scan, inlined: no call and no result object for
        // the field type that dominates the input.
        let start = pos;
        let built = null;
        let i = pos;
        let done = false;
        while (i < n && !done) {
          const c = text.charCodeAt(i);
          if (c === 44) {
            const seg = text.slice(start, i);
            value = built === null ? seg : built + seg;
            pos = i + 1;
            ended = COMMA;
            done = true;
          } else if (c === 10) {
            const seg = text.slice(start, i);
            value = built === null ? seg : built + seg;
            pos = i + 1;
            line += 1;
            ended = LINE_BREAK;
            done = true;
          } else if (c === 13) {
            if (i + 1 < n && text.charCodeAt(i + 1) === 10) {
              const seg = text.slice(start, i);
              value = built === null ? seg : built + seg;
              pos = i + 2;
              line += 1;
              ended = LINE_BREAK;
              done = true;
            } else {
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              const seg = text.slice(start, i);
              built = built === null ? seg : built + seg;
              i += 1;
              start = i;
            }
          } else {
            i += 1;
          }
        }
        if (!done) {
          const seg = text.slice(start, n);
          value = built === null ? seg : built + seg;
          pos = n;
          ended = END;
        }
      }
      if (count < fields.length) fields[count] = value;
      else fields.push(value);
      count += 1;
    }
    fields.length = count;

    // A line that held only stray CRs is left with no characters: no
    // record, though its stray_cr errors stay.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
