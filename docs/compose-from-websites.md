# Compose a post from a website

A website you use (an applicant tracking system, a document tool, your firm's own
site) can hand LinkedIn Toolkit a draft post: text and, if you like, one file. The
toolkit opens LinkedIn's own post box in a new tab, attaches the file, types the
text, and stops. **You read the draft and press Post yourself. The toolkit never
publishes anything.**

## For people using it

1. Open the website, then open LinkedIn Toolkit from the toolbar.
2. Press **Connect this site**. Chrome asks whether the toolkit may use that one site;
   say yes. Nothing else changes: the toolkit gets no access to any other site.
3. On the website, use its "Post with LinkedIn Toolkit" button. A LinkedIn tab opens
   with the draft filled in. Check it and press Post.

To stop a site sending drafts, open the toolkit on that site and press **Disconnect**.

If LinkedIn has changed its page and the file cannot be attached, the toolkit saves
the file to your Downloads, types the text, and tells you where to add the file
(**Add media** for an image or video, **More → Add a document** for a PDF).

## For website developers

The toolkit puts a small bridge script on a site only after the person connects it.
Talk to it with `window.postMessage` on your own page:

```js
// 1. Is the toolkit here and connected? It also says "ready" once when it loads.
window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'lit-bridge') return;
  if (e.data.type === 'ready') toolkitAvailable = true;           // e.data.version
  if (e.data.type === 'composed') console.log(e.data.id, e.data.ok, e.data.error);
});
window.postMessage({ source: 'lit-page', type: 'hello' }, location.origin);

// 2. Hand over a draft. data may be an ArrayBuffer, a Blob or base64.
const pdf = await (await fetch('/files/brief.pdf')).arrayBuffer();
window.postMessage({
  source: 'lit-page', type: 'compose', id: 'any-id',
  draft: { text: 'We are appointing a Chief Operating Officer.',
           file: { name: 'brief.pdf', type: 'application/pdf', title: 'Chief Operating Officer', data: pdf } },
}, location.origin);
```

| Field | Rules |
|---|---|
| `text` | Up to 3,000 characters. Line breaks become paragraphs. |
| `file.type` | `application/pdf` (posted as a document), `image/png`, `image/jpeg`, `image/gif`, `video/mp4`, `video/quicktime` |
| `file.title` | Documents only: the title LinkedIn shows, up to 58 characters |
| `file.data` | Up to 40 MB |

A draft must have text, a file or both. `composed` with `ok: false` carries a sentence
you can show. A draft waits five minutes for its LinkedIn tab, and is collected once.

## What the toolkit does and does not do

- It only runs on sites you connected, and a connected site can do nothing but hand
  over a draft: every other toolkit action from a website tab is refused.
- It never presses Post, Schedule or Publish.
- Drafts stay in your browser: they go from the website's page to the toolkit to the
  LinkedIn tab, and nowhere else.
