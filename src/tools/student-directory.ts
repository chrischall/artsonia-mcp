import type { ArtsoniaClient } from '../client.js';
import { parseStudents } from '../parse.js';

/**
 * The account's followed students, as display labels a caller can name a
 * child by (mcp-host context-groups spec D5: a subject is an enum of LABELS,
 * accepting label or id).
 */
export interface StudentDirectory {
  /** One label per student, in dashboard order; never empty. */
  labels: string[];
  /**
   * A label (any case, trimmed) → that student's artist_id. A raw numeric
   * artist_id passes through unchanged, so a student followed after start is
   * still reachable. Anything else is refused, naming the labels.
   */
  resolve(value: string): string;
}

/** Bound on the start-time listing: a host must not wait on it to list tools. */
export const STUDENT_LIST_TIMEOUT_MS = 5_000;

const NUMERIC_ID = /^\d+$/;

function buildDirectory(students: Array<{ artist_id: string; name: string }>): StudentDirectory | null {
  if (students.length === 0) return null;
  const base = students.map((s) => ({ id: s.artist_id, label: s.name.trim() || s.artist_id }));
  const counts = new Map<string, number>();
  for (const s of base) counts.set(s.label.toLowerCase(), (counts.get(s.label.toLowerCase()) ?? 0) + 1);
  // Two students with one display name would make the name ambiguous, so each
  // carries its id; the label stays resolvable and never picks the wrong child.
  const labelled = base.map((s) => ({
    id: s.id,
    label: counts.get(s.label.toLowerCase())! > 1 && s.label !== s.id ? `${s.label} (${s.id})` : s.label,
  }));
  const byLabel = new Map(labelled.map((s) => [s.label.toLowerCase(), s.id]));
  const labels = labelled.map((s) => s.label);
  return {
    labels,
    resolve(value: string): string {
      const ref = value.trim();
      const id = byLabel.get(ref.toLowerCase());
      if (id !== undefined) return id;
      if (NUMERIC_ID.test(ref)) return ref;
      throw new Error(`Unknown student "${value}". Known: ${labels.join(', ')}.`);
    },
  };
}

/**
 * List the followed students ONCE, at server start, for the canonical read's
 * `artist_id` enum. Answers null — so the property is published with no
 * `enum` keyword, never an empty one — when the account follows nobody, when
 * the listing fails (no credentials, no browser on the fetchproxy transport),
 * or when it has not answered within `timeoutMs`. Never throws.
 */
export async function loadStudentDirectory(
  client: ArtsoniaClient,
  timeoutMs: number = STUDENT_LIST_TIMEOUT_MS,
): Promise<StudentDirectory | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  const listing = Promise.resolve()
    .then(() => client.fetchHtml('/members/'))
    .then((html) => buildDirectory(parseStudents(html)))
    .catch(() => null);
  try {
    return await Promise.race([listing, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
