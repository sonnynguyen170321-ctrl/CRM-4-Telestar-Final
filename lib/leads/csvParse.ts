/**
 * CSV parsing and header detection for the lead importer.
 *
 * Both used to live inside `components/CSVImportModal.tsx`, which is why neither had a test:
 * nothing exported them. They decide which spreadsheet column becomes which lead field, so a
 * mistake here is not a failed import — it is an import that succeeds with the wrong values in
 * the wrong columns, and nobody finds out until an SDR calls a switchboard expecting a person.
 */

/**
 * A quote-aware CSV reader.
 *
 * The previous version did `text.split(/\r?\n/)` and *then* handled quotes inside each line, so a
 * quoted field containing a newline — a postal address, a notes column, a company description, all
 * routine in vendor exports — was torn into two rows. The first row lost its trailing columns and
 * the second became a lead whose company was the remainder of someone's address. Quotes have to be
 * tracked across the newline, so the scan runs over the whole text at once.
 */
export const parseCSV = (text: string): { headers: string[]; rows: string[][] } => {
  // A BOM would otherwise become part of the first header name and break every match against it.
  const input = text.replace(/^﻿/, '');

  const allRows: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  const endField = () => {
    row.push(current.trim());
    current = '';
  };
  const endRow = () => {
    endField();
    // A blank line carries no data; keeping it would offset every row number reported back to
    // the operator, and the review screen refers to rows by number.
    if (row.some((cell) => cell !== '')) allRows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r') {
      // CRLF: the \n is consumed here so it does not start an extra empty row.
      if (input[i + 1] === '\n') i++;
      endRow();
    } else if (ch === '\n') {
      endRow();
    } else {
      current += ch;
    }
  }
  // An unterminated final line still holds a row's worth of data.
  if (current !== '' || row.length > 0) endRow();

  if (allRows.length === 0) return { headers: [], rows: [] };
  return { headers: allRows[0], rows: allRows.slice(1) };
};

/**
 * How a header is matched to a lead field.
 *
 * `reject` exists because the old detector was first-match-wins over one pattern per field, and
 * the patterns overlapped badly on the headers real vendor files actually carry:
 *
 *   - `/phone/i` matched "Company Phone", so the contact's phone became the switchboard number
 *   - `/linkedin/i` matched "Company LinkedIn", so every employee got the company page
 *   - `/e[\s-]?mail/i` matched "Email Score" and "Email Validation" before "Email"
 *   - `/country/i` matched "Company Country"
 *   - `/company/i` matched "Company Phone", so the company name became a phone number
 *
 * The first two are the worst, because `findDuplicate` indexes incoming rows by normalized phone
 * and LinkedIn: give a hundred colleagues one switchboard number and the importer decides they are
 * all the same person. `prefer` then breaks remaining ties toward the plainest header, so "Email"
 * wins over "Alternate Email" whatever order the columns arrive in.
 */
type HeaderRule = { match: RegExp; reject?: RegExp; prefer?: RegExp };

const HEADER_RULES: Record<string, HeaderRule> = {
  firstName: { match: /first[\s_-]?name/i },
  lastName: { match: /last[\s_-]?name/i },
  fullName: { match: /full[\s_-]?name|contact name/i },
  title: { match: /title|position|role|job/i, reject: /company|account|org\b/i },
  email: {
    match: /e[\s-]?mail/i,
    reject: /valid|status|score|state|quality|alt(ernate|ernative)?|second|2nd|company|verif/i,
    prefer: /^e[\s-]?mail(\s*address)?$/i,
  },
  phone: {
    match: /phone|tel(ephone)?\b|mobile|cell/i,
    reject: /company|office|switchboard|hq|main|second|2nd|alt/i,
    prefer: /^(contact\s*)?(phone|mobile)(\s*number)?$/i,
  },
  linkedIn: { match: /linkedin|linked in/i, reject: /company|org(anization)?|account|url\s*company/i },
  company: {
    match: /company|org(anization)?|account/i,
    reject: /phone|tel|linkedin|country|website|domain|size|staff|employee|industry|revenue|email|url/i,
    prefer: /^(company|account|organi[sz]ation)(\s*name)?$/i,
  },
  website: { match: /website|domain|url/i, reject: /linkedin|email/i },
  industry: { match: /industry|vertical|sector/i },
  contactCountry: { match: /country|location|region/i, reject: /company|hq|office|headquarter/i },
  priority: { match: /priority|tier/i },
};

/**
 * Picks one header per field, and never gives the same header to two fields.
 *
 * Without the claim check, `company` and `phone` could both resolve to "Company Phone" — the
 * company name and the contact's phone reading from one column of switchboard numbers. Fields are
 * resolved in the order above, so the more specific ones claim their column first.
 */
export const detectFieldMap = (headers: string[]): Record<string, string> => {
  const map: Record<string, string> = {};
  const claimed = new Set<string>();

  for (const [field, rule] of Object.entries(HEADER_RULES)) {
    const candidates = headers.filter(
      (header) =>
        !claimed.has(header) && rule.match.test(header) && !(rule.reject && rule.reject.test(header))
    );
    if (candidates.length === 0) continue;

    const exact = rule.prefer && candidates.find((header) => rule.prefer!.test(header.trim()));
    // Shortest header as the tiebreak: extra words are qualifiers ("Alternate", "Company HQ"),
    // and the field we want is the unqualified one.
    const chosen =
      exact ?? [...candidates].sort((a, b) => a.length - b.length || headers.indexOf(a) - headers.indexOf(b))[0];

    map[field] = chosen;
    claimed.add(chosen);
  }

  return map;
};
