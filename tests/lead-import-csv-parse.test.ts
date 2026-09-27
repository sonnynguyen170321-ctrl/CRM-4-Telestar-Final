import { describe, it, expect } from 'vitest';
import { parseCSV, detectFieldMap } from '@/lib/leads/csvParse';

/**
 * Both functions lived in `components/CSVImportModal.tsx` and were unexported, so neither had ever
 * been tested. Every case below is a spreadsheet shape a vendor export actually produces, and in
 * every one of them the old code imported *something* — it never failed, it just wrote the wrong
 * value into the wrong field.
 */

describe('parseCSV', () => {
  it('keeps a row together when a quoted field contains a newline', () => {
    // The defect: the old parser split on /\r?\n/ before it looked at quotes, so this single
    // record became two rows — the first missing its last two columns, the second a lead whose
    // company was "Suite 400, Springfield".
    const csv = [
      'First Name,Address,Company,Email',
      'Pat,"12 Main St',
      'Suite 400, Springfield",Acme Robotics,pat@acme.test',
    ].join('\n');

    const { headers, rows } = parseCSV(csv);

    expect(headers).toEqual(['First Name', 'Address', 'Company', 'Email']);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('12 Main St\nSuite 400, Springfield');
    expect(rows[0][2]).toBe('Acme Robotics');
    expect(rows[0][3]).toBe('pat@acme.test');
  });

  it('handles CRLF without producing an empty row between records', () => {
    const { rows } = parseCSV('a,b\r\n1,2\r\n3,4\r\n');
    expect(rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('reads escaped quotes as one quote, and commas inside quotes as text', () => {
    const { rows } = parseCSV('company,note\n"Acme, Inc.","he said ""no"" twice"');
    expect(rows[0]).toEqual(['Acme, Inc.', 'he said "no" twice']);
  });

  it('strips a BOM so the first header still matches', () => {
    const { headers } = parseCSV('﻿Email,Company\na@b.test,Acme');
    expect(headers[0]).toBe('Email');
  });

  it('keeps a last line that has no trailing newline', () => {
    const { rows } = parseCSV('a,b\n1,2');
    expect(rows).toEqual([['1', '2']]);
  });

  it('returns nothing for an empty file rather than a header of one empty string', () => {
    expect(parseCSV('')).toEqual({ headers: [], rows: [] });
    expect(parseCSV('\n\n')).toEqual({ headers: [], rows: [] });
  });
});

describe('detectFieldMap', () => {
  it('does not give the contact the company switchboard number', () => {
    // The consequence is not a cosmetic mismapping. `findDuplicate` indexes incoming rows by
    // normalized phone, so one switchboard number across a file made the importer treat every
    // colleague as the same person.
    const map = detectFieldMap(['Company Phone', 'Contact Phone', 'Email', 'Company Name']);
    expect(map.phone).toBe('Contact Phone');
  });

  it('does not give the contact the company LinkedIn page', () => {
    const map = detectFieldMap(['Company Linkedin Url', 'Person Linkedin Url']);
    expect(map.linkedIn).toBe('Person Linkedin Url');
  });

  it('picks the email address over the columns that describe it', () => {
    // Apollo-shaped export: the scoring columns come first.
    const map = detectFieldMap(['Email Score', 'Email Validation Status', 'Email', 'Alternate Email']);
    expect(map.email).toBe('Email');
  });

  it('does not read the company name out of a column of phone numbers', () => {
    const map = detectFieldMap(['Company Phone', 'Company', 'Email']);
    expect(map.company).toBe('Company');
  });

  it('keeps company country out of contact country', () => {
    const map = detectFieldMap(['Company Country', 'Contact Country']);
    expect(map.contactCountry).toBe('Contact Country');
  });

  it('never hands one header to two different fields', () => {
    // "Company Phone" alone used to satisfy both `company` and `phone`.
    const map = detectFieldMap(['Company Phone', 'Email', 'First Name']);
    const used = Object.values(map);
    expect(new Set(used).size).toBe(used.length);
  });

  it('still maps a plain, well-formed header row', () => {
    const map = detectFieldMap([
      'First Name',
      'Last Name',
      'Title',
      'Company',
      'Email',
      'Phone',
      'LinkedIn',
      'Website',
      'Industry',
    ]);
    expect(map).toMatchObject({
      firstName: 'First Name',
      lastName: 'Last Name',
      title: 'Title',
      company: 'Company',
      email: 'Email',
      phone: 'Phone',
      linkedIn: 'LinkedIn',
      website: 'Website',
      industry: 'Industry',
    });
  });

  it('leaves a field unmapped rather than guessing when no column fits', () => {
    const map = detectFieldMap(['Email', 'Company']);
    expect(map.phone).toBeUndefined();
    expect(map.linkedIn).toBeUndefined();
  });
});
