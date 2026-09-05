import type { ResearchSession } from '../../research/types.js';

/**
 * Derived tags for the report catalog: the most frequent meaningful words in the title and goal
 * (weight 2) and the top three candidate titles (weight 1). Tags a person set explicitly always
 * come first and are never counted twice.
 */

const STOPWORDS = new Set([
  'a',
  'about',
  'after',
  'again',
  'all',
  'also',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'being',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
  // Words every council goal tends to contain.
  'analyze',
  'analyse',
  'repository',
  'repo',
  'generate',
  'hypotheses',
  'hypothesis',
  'about',
  'design',
  'risks',
  'next',
  'experiments',
  'highest',
  'value',
  'correctness',
  'its',
  'explain',
  'why',
  'whether',
  'using',
  'used',
  'use',
  'new',
  'via',
]);

/** Lower-case alphabetic words of three or more letters that are not stopwords. */
export function tokenizeWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []).filter(
    (word) => !STOPWORDS.has(word) && (word.match(/[a-z]/g) ?? []).length >= 3
  );
}

export function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/\s+/g, '-');
}

export function deriveTags(session: ResearchSession, max = 6): string[] {
  const userTags = [...new Set((session.meta?.tags ?? []).map(normalizeTag).filter(Boolean))];
  const weights = new Map<string, number>();
  const bump = (text: string | undefined, weight: number) => {
    if (!text) return;
    for (const word of new Set(tokenizeWords(text))) {
      weights.set(word, (weights.get(word) ?? 0) + weight);
    }
  };
  bump(session.meta?.title, 2);
  bump(session.goal, 2);
  const top = session.candidates
    .filter((candidate) => candidate.status === 'distinct')
    .sort((left, right) => (left.rank || 999) - (right.rank || 999))
    .slice(0, 3);
  for (const candidate of top) bump(candidate.title, 1);
  const derived = [...weights.entries()]
    .filter(([word]) => !userTags.includes(word))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([word]) => word);
  return [...userTags, ...derived].slice(0, Math.max(max, userTags.length));
}
