/**
 * LinkedIn Toolkit — reading LinkedIn's "normalized" responses.
 *
 * Every Voyager call the engine makes asks for
 * `application/vnd.linkedin.normalized+json+2.1`, which means the body is
 * flattened: the payload is a graph of `{ data, included }` where `data` holds
 * paging plus *references* (`"*elements": ["urn:li:fsd_profile:…"]`,
 * `"*geo": "urn:li:fsd_geo:104116203"`) and `included` holds the entities
 * themselves, each stamped with `$type` and `entityUrn`.
 *
 * So nothing can be read by walking the body alone — a reference has to be
 * looked up. These four functions are the whole vocabulary the normalizers
 * need, and they are deliberately shape-agnostic: GraphQL responses nest the
 * collection one extra level under `data.data.<queryName>`, REST ones put it
 * straight on `data`, and messaging GraphQL names its collection after the
 * query. `collection()` finds it in all three without being told which is
 * which, so a queryId refresh does not need a normalizer change.
 *
 * Everything here is pure: raw payload in, plain objects out.
 */

/** Reference fields look like `"*elements"` / `"*geo"`; values are urns. */
const REF = /^\*/;

/**
 * Index a payload's `included` array by `entityUrn`.
 *
 * @param {object} payload a normalized Voyager response
 * @returns {Map<string, object>} urn → entity
 */
export function index(payload) {
  const map = new Map();
  const included = (payload && payload.included) || [];
  for (const entity of included) {
    if (entity && entity.entityUrn) map.set(entity.entityUrn, entity);
  }
  return map;
}

/**
 * Follow one reference.
 *
 * `ref` may be a urn string, an object carrying a `*field` reference, or an
 * entity already inlined — all three happen in the same response — so this
 * returns the entity for a urn and the object itself for anything else.
 *
 * @param {string|object|null} ref
 * @param {Map<string, object>} idx from `index()`
 * @returns {object|null}
 */
export function resolve(ref, idx) {
  if (!ref) return null;
  if (typeof ref === 'string') return (idx && idx.get(ref)) || null;
  if (typeof ref !== 'object') return null;
  return ref;
}

/**
 * Resolve a named reference off an entity: `field('*geo')` or `field('geo')`
 * both work, and an inlined value is returned as-is.
 */
export function field(entity, name, idx) {
  if (!entity) return null;
  const key = REF.test(name) ? name : `*${name}`;
  const plain = REF.test(name) ? name.slice(1) : name;
  if (entity[key] !== undefined) return resolve(entity[key], idx);
  if (entity[plain] !== undefined) return resolve(entity[plain], idx);
  return null;
}

/**
 * Resolve a named list off an entity.
 *
 * The same field arrives three ways depending on how deeply LinkedIn
 * normalised the response: `"*participants": ["urn:…", …]`,
 * `"participants": ["urn:…", …]`, or `"participants": [{…}, …]` inlined. All
 * three mean the same thing, and a caller that reads only the inline form
 * silently gets an empty list from a response that was carrying the data.
 *
 * @returns {object[]} resolved entities, unresolvable references dropped
 */
export function list(entity, name, idx) {
  if (!entity) return [];
  const key = REF.test(name) ? name : `*${name}`;
  const plain = REF.test(name) ? name.slice(1) : name;
  const raw = Array.isArray(entity[key]) ? entity[key] : entity[plain];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => resolve(item, idx)).filter(Boolean);
}

/**
 * The node a response's collection hangs off.
 *
 * REST: `payload.data`. GraphQL: `payload.data.data.<queryName>`. Messaging
 * GraphQL sometimes drops the second `data`. The caller does not care which.
 */
export function root(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const data = payload.data;
  if (!data || typeof data !== 'object') return payload;
  if (data.data && typeof data.data === 'object') return data.data;
  return data;
}

/** Keys that are metadata rather than a place a collection could hide. */
const NOT_A_COLLECTION = new Set(['extensions', 'metadata', 'paging', 'meta']);

function hasElements(node) {
  return (
    node &&
    typeof node === 'object' &&
    (Array.isArray(node.elements) || Array.isArray(node['*elements']))
  );
}

/**
 * The node holding `elements` / `*elements`, wherever LinkedIn put it.
 *
 * Searches the root and then one level of named query results, which covers
 * `searchDashClustersByAll`, `organizationDashCompaniesByUniversalName`,
 * `messengerConversationsByCategoryQuery`, `messengerMessagesByConversation`
 * and the plain REST collection response alike.
 *
 * @returns {object|null}
 */
export function collection(payload) {
  const node = root(payload);
  if (hasElements(node)) return node;
  for (const [key, value] of Object.entries(node || {})) {
    if (key.startsWith('$') || NOT_A_COLLECTION.has(key)) continue;
    if (hasElements(value)) return value;
  }
  return null;
}

/**
 * The elements of a response, resolved through `included`.
 *
 * @param {object} payload
 * @param {Map<string, object>} [idx] reuse an index if you already built one
 * @returns {object[]} entities, references followed, unresolvable ones dropped
 */
export function elements(payload, idx = index(payload)) {
  const node = collection(payload);
  if (!node) return [];
  const raw = Array.isArray(node['*elements']) ? node['*elements'] : node.elements;
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => resolve(item, idx)).filter(Boolean);
}

/** True when the payload carries a collection at all (empty or not). */
export function hasCollection(payload) {
  return collection(payload) !== null;
}

/** Total result count, from whichever of the three places carries it. */
export function total(payload) {
  const node = collection(payload) || root(payload) || {};
  const metadata = node.metadata || {};
  if (typeof metadata.totalResultCount === 'number') return metadata.totalResultCount;
  if (node.paging && typeof node.paging.total === 'number') return node.paging.total;
  const rootNode = root(payload);
  if (rootNode.paging && typeof rootNode.paging.total === 'number') return rootNode.paging.total;
  return undefined;
}

/** Every included entity whose `$type` ends with `suffix`. */
export function entitiesOfType(payload, suffix) {
  const included = (payload && payload.included) || [];
  return included.filter((e) => e && typeof e.$type === 'string' && e.$type.endsWith(suffix));
}

/** `{ text: 'Ada Lovelace' }`, `'Ada Lovelace'` and `null` all read the same. */
export function textOf(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return textOf(value.text);
  return String(value);
}
