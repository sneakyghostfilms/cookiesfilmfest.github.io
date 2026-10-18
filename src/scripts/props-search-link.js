// A scene result links a prop to the keyword page's search for it. The prop rides in the URL fragment, never a query
// string, so a name the AI took from someone's scene never reaches the host's request log.
export function keywordSearchHref(prop) {
  return `/props#q=${encodeURIComponent(prop)}`;
}

// The keyword page's search text from its URL fragment; "" for any other fragment, such as #prop-sources.
export function queryFromHash(hash) {
  return new URLSearchParams(hash.replace(/^#/, '')).get('q') ?? '';
}
