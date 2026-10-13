/**
 * The composer's content score: a deterministic read of the draft (no AI, no network), shown next
 * to the editor and updated as the rep types.
 *
 * What a cold email is judged on by the people and filters that receive it: length, how hard it is
 * to read, links and images (deliverability), trigger words, whether it asks one clear question,
 * whether it is personal at all, a subject that shouts, and whether it talks about the sender or
 * the reader. One score 0-100 (100 minus the penalties below) and at most five tips, biggest first.
 *
 * The thresholds are a cold-outreach rule of thumb, not a law: 50-125 words, one link, no images,
 * one question, a subject under ~60 characters. Vietnamese gets the same checks except the reading
 * grade, which is an English formula.
 *
 * Pure, client and server.
 */
import { htmlToPlainText, unchipifyMergeTags } from './html';
import { findMergeTags } from './merge';
import { isHtml } from '@/lib/email/sanitize';

export type ContentLanguage = 'en' | 'vi';

export interface ContentMetrics {
  words: number;
  sentences: number;
  /** Flesch-Kincaid grade for English; null for Vietnamese or a draft too short to judge. */
  readingGrade: number | null;
  links: number;
  images: number;
  questions: number;
  spamWords: string[];
  /** The merge fields used in subject and body, once each. */
  variables: string[];
  subjectLength: number;
  subjectAllCaps: boolean;
  subjectExclamations: number;
  /** "I", "we", "our"... against "you", "your"... */
  firstPerson: number;
  secondPerson: number;
}

export interface ContentScore {
  /** Nothing written yet: no score, no tips. */
  empty: boolean;
  score: number;
  label: 'Strong' | 'Good' | 'Needs work';
  language: ContentLanguage;
  metrics: ContentMetrics;
  tips: string[];
}

const MAX_TIPS = 5;
const IDEAL_MAX_WORDS = 125;
const LONG_WORDS = 200;
const MIN_WORDS = 25;
const SUBJECT_MAX_CHARS = 60;
const MIN_WORDS_FOR_GRADE = 12;

/** English trigger words and phrases spam filters and readers both react to. Lower case. */
const SPAM_EN = [
  'free', 'risk-free', 'guarantee', 'guaranteed', '100%', 'act now', 'buy now', 'order now', 'apply now', 'click here',
  'limited time', 'urgent', 'winner', 'congratulations', 'cash', 'earn money', 'make money', 'double your',
  'no obligation', 'no cost', 'best price', 'lowest price', 'cheap', 'special promotion', 'exclusive deal',
  'once in a lifetime', 'amazing', 'incredible offer', 'dear friend', 'this is not spam', '$$$',
];
/** Vietnamese ones: free, promotion, discount, last chance, hurry, win a prize, today only... */
const SPAM_VI = [
  'miễn phí', 'khuyến mãi', 'giảm giá', 'cơ hội cuối', 'nhanh tay', 'trúng thưởng', 'chỉ hôm nay', 'cam kết 100%',
  'kiếm tiền', 'ưu đãi đặc biệt', 'không mất phí', 'quà tặng',
];
const SPAM_TERMS = [...SPAM_EN, ...SPAM_VI];

const FIRST_PERSON_EN = new Set(['i', "i'm", "i've", "i'd", "i'll", 'me', 'my', 'mine', 'myself', 'we', "we're", "we've", "we'd", "we'll", 'our', 'ours', 'us']);
const SECOND_PERSON_EN = new Set(['you', 'your', 'yours', "you're", "you've", "you'd", "you'll", 'yourself', 'yourselves']);
const FIRST_PERSON_VI = ['chúng tôi', 'bên em', 'bên mình', 'tôi', 'mình'];
const SECOND_PERSON_VI = ['quý công ty', 'bạn', 'anh', 'chị', 'quý'];

/** Letters only Vietnamese uses among Latin scripts (plain acute and grave are left out: French has them). */
const VI_LETTERS = /[ăâđêôơưạảãấầẩẫậắằẳẵặẹẻẽếềểễệỉĩịọỏõốồổỗộớờởỡợụủũứừửữựỳỵỷỹ]/i;

const normalise = (text: string) => text.normalize('NFC').replace(/[’‘]/g, "'");

function wordsOf(text: string): string[] {
  return normalise(text).match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
}

export function detectLanguage(text: string): ContentLanguage {
  const words = wordsOf(text);
  if (words.length === 0) return 'en';
  const vi = words.filter((w) => VI_LETTERS.test(w)).length;
  return vi / words.length >= 0.25 ? 'vi' : 'en';
}

/** Vowel groups, a silent final "e" taken off (but "-le" after a consonant kept), at least one. */
export function syllableCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  let count = (w.match(/[aeiouy]+/g) ?? []).length;
  if (/[^aeiou]e$/.test(w) && !/[^aeiouy]le$/.test(w)) count--;
  return Math.max(1, count);
}

/**
 * The text a reader actually reads: merge tags as one word, the first spintax option, both sides of
 * a conditional (the syntax itself dropped), markup gone.
 */
function readableText(body: string): string {
  let text = isHtml(body) ? htmlToPlainText(body) : body;
  text = text.replace(/\{\{\s*(?:#if\b[^}]*|else|\/if)\s*\}\}/g, ' ');
  text = text.replace(/\{\{\s*([a-zA-Z][\w.]*)[^}]*\}\}/g, (_w, field: string) => field.replace(/\./g, ''));
  for (let guard = 0; guard < 10 && /\{[^{}|]*\|[^{}]*\}/.test(text); guard++) {
    text = text.replace(/\{([^{}|]*)\|[^{}]*\}/g, '$1');
  }
  return text;
}

function countTerm(haystack: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (haystack.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')) ?? []).length;
}

function countLinks(body: string): number {
  if (isHtml(body)) {
    const anchors = (body.match(/<a\b[^>]*\bhref\s*=/gi) ?? []).length;
    const bare = (htmlToPlainText(body.replace(/<a\b[\s\S]*?<\/a>/gi, ' ')).match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? []).length;
    return anchors + bare;
  }
  return (body.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? []).length;
}

function isShouting(subject: string): boolean {
  const letters = subject.replace(/\{\{[^}]*\}\}/g, '').replace(/[^\p{L}]/gu, '');
  return letters.length >= 6 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

function personCounts(text: string, language: ContentLanguage): { first: number; second: number } {
  if (language === 'vi') {
    const lower = normalise(text).toLowerCase();
    // Longest phrases first, each match removed so "chúng tôi" is not counted again as "tôi".
    const count = (terms: string[]) => {
      let rest = lower;
      let total = 0;
      for (const term of terms) {
        total += countTerm(rest, term);
        rest = rest.replace(new RegExp(`(?<![\\p{L}\\p{N}])${term}(?![\\p{L}\\p{N}])`, 'giu'), ' ');
      }
      return total;
    };
    return { first: count(FIRST_PERSON_VI), second: count(SECOND_PERSON_VI) };
  }
  const words = wordsOf(text).map((w) => w.toLowerCase());
  return { first: words.filter((w) => FIRST_PERSON_EN.has(w)).length, second: words.filter((w) => SECOND_PERSON_EN.has(w)).length };
}

function gradeOf(words: string[], sentences: number): number | null {
  if (words.length < MIN_WORDS_FOR_GRADE) return null;
  const syllables = words.reduce((sum, w) => sum + syllableCount(w), 0);
  const grade = 0.39 * (words.length / Math.max(1, sentences)) + 11.8 * (syllables / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

export function measureContent(input: { subject: string; body: string }): { language: ContentLanguage; metrics: ContentMetrics } {
  const body = unchipifyMergeTags(input.body ?? '');
  const subject = unchipifyMergeTags(input.subject ?? '').trim();
  const text = readableText(body);
  const words = wordsOf(text);
  const language = detectLanguage(text);
  const sentences = Math.max(1, (text.match(/[.!?]+(?=\s|$)/g) ?? []).length);
  const both = normalise(`${subject}\n${text}`).toLowerCase();
  const people = personCounts(text, language);
  return {
    language,
    metrics: {
      words: words.length,
      sentences,
      readingGrade: language === 'en' ? gradeOf(words, sentences) : null,
      links: countLinks(body),
      images: (body.match(/<img\b/gi) ?? []).length,
      questions: (text.match(/\?+/g) ?? []).length,
      spamWords: SPAM_TERMS.filter((term) => countTerm(both, term) > 0),
      variables: [...new Set(findMergeTags(`${subject}\n${body}`).map((tag) => tag.field))],
      subjectLength: subject.length,
      subjectAllCaps: isShouting(subject),
      subjectExclamations: (subject.match(/!/g) ?? []).length,
      firstPerson: people.first,
      secondPerson: people.second,
    },
  };
}

interface Penalty { points: number; tip: string }

function penalties(m: ContentMetrics): Penalty[] {
  const out: Penalty[] = [];
  const add = (points: number, tip: string) => out.push({ points, tip });

  if (m.words > LONG_WORDS) add(15, `Cut it to under ${IDEAL_MAX_WORDS} words (now ${m.words}). Short cold emails get more replies.`);
  else if (m.words > IDEAL_MAX_WORDS) add(8, `Trim it toward ${IDEAL_MAX_WORDS} words (now ${m.words}).`);
  else if (m.words < MIN_WORDS) add(10, `Add a line of context: ${m.words} words may read as abrupt.`);

  if (m.readingGrade !== null && m.readingGrade > 10) add(12, `Use shorter sentences and plainer words (reading grade ${m.readingGrade}; aim for 8 or below).`);
  else if (m.readingGrade !== null && m.readingGrade > 8) add(6, `Simplify a little: reading grade ${m.readingGrade}, aim for 8 or below.`);

  if (m.links >= 3) add(12, `Keep to one link (now ${m.links}). Several links look like a newsletter to spam filters.`);
  else if (m.links === 2) add(5, 'Keep to one link: two links compete for the click.');

  if (m.images >= 3) add(10, `Drop the images (${m.images}): a first email with images is more often filtered.`);
  else if (m.images > 0) add(5, 'Consider sending without the image: plain first emails land in the inbox more often.');

  if (m.spamWords.length > 0) {
    const shown = m.spamWords.slice(0, 3).map((w) => `"${w}"`).join(', ');
    add(Math.min(20, 5 * m.spamWords.length), `Rephrase trigger words: ${shown}${m.spamWords.length > 3 ? ` and ${m.spamWords.length - 3} more` : ''}.`);
  }

  if (m.questions === 0) add(8, 'End with one clear question so replying is easy.');
  else if (m.questions > 3) add(4, `Ask fewer questions (${m.questions}); one clear ask gets more answers.`);

  if (m.variables.length === 0) add(12, 'Make it personal: add {{firstName}} or a line about their company.');

  if (m.subjectLength === 0) add(10, 'Add a subject line.');
  else if (m.subjectLength > SUBJECT_MAX_CHARS) add(6, `Shorten the subject to under ${SUBJECT_MAX_CHARS} characters (now ${m.subjectLength}).`);
  if (m.subjectAllCaps) add(10, 'Do not write the subject in capitals: it reads as shouting.');
  if (m.subjectExclamations > 1) add(6, 'Drop the exclamation marks in the subject.');
  else if (m.subjectExclamations === 1) add(2, 'A subject without "!" reads calmer.');

  if (m.firstPerson >= 3 && m.firstPerson > m.secondPerson * 1.5) {
    add(8, `Talk about them more than about you: ${m.firstPerson} "I/we" to ${m.secondPerson} "you".`);
  }
  return out;
}

export function scoreContent(input: { subject: string; body: string }): ContentScore {
  const { language, metrics } = measureContent(input);
  if (metrics.words === 0) return { empty: true, score: 0, label: 'Needs work', language, metrics, tips: [] };
  const found = penalties(metrics);
  const score = Math.max(0, Math.min(100, 100 - found.reduce((sum, p) => sum + p.points, 0)));
  const tips = [...found].sort((a, b) => b.points - a.points).slice(0, MAX_TIPS).map((p) => p.tip);
  return { empty: false, score, label: score >= 80 ? 'Strong' : score >= 60 ? 'Good' : 'Needs work', language, metrics, tips };
}
