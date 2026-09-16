import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'wxmp-test-')); process.env.WX_MP_PUBLISHER_STATE_DIR=root;
const m=await import('../scripts/direct_wx_mp.mjs');
const css=path.resolve('/Users/chenjie/.openclaw/workspace-main/wx_mp/wenyan-theme/frontier-editorial-blue.css');
function assertNewspicText(value){
  assert.equal(typeof value,'string');
  assert.doesNotMatch(value,/</); assert.doesNotMatch(value,/>/);
  assert.doesNotMatch(value,/<!--[\\s\\S]*?(?:-->|$)/);
  assert.doesNotMatch(value,/&(?:#\\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i);
  assert.doesNotMatch(value,/(^|\\n)\\s{0,3}(?:#{1,6}\\s+|[-*+]\\s+|>\\s+)/);
  assert.doesNotMatch(value,/[*_~`]/);
}
async function account(){await fs.writeFile(path.join(root,'accounts.json'),JSON.stringify({default:'a',accounts:[{alias:'a',appId:'wx-id',appSecret:'very-secret'}]}));}
function response(data,status=200){return {ok:status<400,status,json:async()=>data};}
test('token cache uses safety margin and atomically stores private cache',async()=>{await account();let n=0; const a=await m.loadAccount();const http=async u=>{n++;assert.match(String(u),/secret=very-secret/);return response({access_token:'token-secret',expires_in:7200});};assert.equal(await m.getToken(a,http,()=>1000),'token-secret');assert.equal(await m.getToken(a,http,()=>1001),'token-secret');assert.equal(n,1);const st=await fs.stat(path.join(root,'token-cache.json'));assert.equal(st.mode&0o777,0o600);});
test('direct upload sequence replaces body images, uploads cover, and posts draft payload',async()=>{await account();const dir=await fs.mkdtemp(path.join(root,'article-'));await fs.writeFile(path.join(dir,'a.jpg'),'a');await fs.writeFile(path.join(dir,'cover.jpg'),'c');await fs.writeFile(path.join(dir,'a.md'),'---\ntitle: T\ncover: cover.jpg\nneed_open_comment: true\nonly_fans_can_comment: false\n---\n\n# T\n\n![x](a.jpg)');const seen=[];const http=async(url,options={})=>{seen.push([url.pathname,options]);if(url.pathname==='/cgi-bin/token')return response({access_token:'token',expires_in:7200});if(url.pathname==='/cgi-bin/media/uploadimg')return response({url:'https://m.wx/a.jpg'});if(url.pathname==='/cgi-bin/material/add_material')return response({media_id:'thumb'});if(url.pathname==='/cgi-bin/draft/add')return response({media_id:'draft'});throw Error('unexpected '+url.pathname);};const out=await m.publishDraft({markdownPath:path.join(dir,'a.md'),http,cssPath:css});assert.equal(out.media_id,'draft');assert.deepEqual(seen.map(x=>x[0]),['/cgi-bin/token','/cgi-bin/media/uploadimg','/cgi-bin/material/add_material','/cgi-bin/draft/add']);const payload=JSON.parse(seen.at(-1)[1].body);assert.equal(payload.articles[0].thumb_media_id,'thumb');assert.match(payload.articles[0].content,/https:\/\/m.wx\/a.jpg/);assert.doesNotMatch(payload.articles[0].content,/<style|<script|src="a\.jpg"/);});
test('direct image_list creates official newspic draft with rendered prose and non-duplicated Markdown images',async()=>{await account();await fs.rm(path.join(root,'token-cache.json'),{force:true});const dir=await fs.mkdtemp(path.join(root,'image-list-'));await fs.writeFile(path.join(dir,'1.jpg'),'one');await fs.writeFile(path.join(dir,'2.jpg'),'two');await fs.writeFile(path.join(dir,'a.md'),'---\ntitle: Carousel\nimage_list:\n  - 1.jpg\n  - 2.jpg\n---\n\nIntro prose.\n\n![one](1.jpg)\n\nTail prose.');const seen=[];const http=async(url,options={})=>{seen.push([url.pathname,options]);if(url.pathname==='/cgi-bin/token')return response({access_token:'token',expires_in:7200});if(url.pathname==='/cgi-bin/material/add_material')return response({media_id:url.searchParams.get('type')==='image' ? `img-${seen.length}` : 'unexpected'});if(url.pathname==='/cgi-bin/draft/add')return response({media_id:'image-draft'});throw Error('unexpected '+url.pathname);};const out=await m.publishDraft({markdownPath:path.join(dir,'a.md'),http,cssPath:css});assert.equal(out.media_id,'image-draft');assert.equal(out.imageList,true);assert.deepEqual(seen.map(x=>x[0]),['/cgi-bin/token','/cgi-bin/material/add_material','/cgi-bin/material/add_material','/cgi-bin/draft/add']);const payload=JSON.parse(seen.at(-1)[1].body);assert.deepEqual(payload.articles[0].image_info,{image_list:[{image_media_id:'img-2'},{image_media_id:'img-3'}]});assert.match(payload.articles[0].content,/Intro prose/);assert.match(payload.articles[0].content,/Tail prose/);assertNewspicText(payload.articles[0].content);assert.doesNotMatch(payload.articles[0].content,/<img\b|1\.jpg/);assert.equal(payload.articles[0].image_info.image_list.length,2);});


test('direct image_list update reuploads images and preserves rendered prose',async()=>{await account();await fs.rm(path.join(root,'token-cache.json'),{force:true});const dir=await fs.mkdtemp(path.join(root,'image-list-update-'));await fs.writeFile(path.join(dir,'1.jpg'),'one');await fs.writeFile(path.join(dir,'2.jpg'),'two');await fs.writeFile(path.join(dir,'a.md'),'---\ntitle: Updated Carousel\nimage_list:\n  - 1.jpg\n  - 2.jpg\n---\n\nUpdated prose & more <b>unsafe</b>.\n\n![duplicate](1.jpg)');const seen=[];const http=async(url,options={})=>{seen.push([url.pathname,options]);if(url.pathname==='/cgi-bin/token')return response({access_token:'token',expires_in:7200});if(url.pathname==='/cgi-bin/material/add_material')return response({media_id:`new-img-${seen.length}`});if(url.pathname==='/cgi-bin/draft/update')return response({errcode:0});throw Error('unexpected '+url.pathname);};const old='old-image-draft-media-id';const out=await m.publishDraft({markdownPath:path.join(dir,'a.md'),http,cssPath:css,updateMediaId:old});assert.equal(out.media_id,old);assert.equal(out.updated,true);assert.equal(out.imageList,true);assert.deepEqual(seen.map(x=>x[0]),['/cgi-bin/token','/cgi-bin/material/add_material','/cgi-bin/material/add_material','/cgi-bin/draft/update']);const wire=seen.at(-1)[1].body;const payload=JSON.parse(wire);assert.equal(JSON.stringify(payload.articles.content),JSON.stringify('Updated prose  more unsafe.'));assert.equal(payload.articles.content.match(/Updated prose/g).length,1);assertNewspicText(payload.articles.content);assert.doesNotMatch(payload.articles.content,/<img\b|1\.jpg/);assert.deepEqual(payload.articles.image_info,{image_list:[{image_media_id:'new-img-2'},{image_media_id:'new-img-3'}]});assert.ok(!seen.some(x=>x[0]==='/cgi-bin/draft/add'));});

test('newspic content is reduced to official plain-text format',()=>{
  assert.equal(m.imageMessageText('<section><h2>标题</h2><p>正文 <strong>加粗</strong><br>下一行</p><ul><li>一</li><li>二</li></ul></section>'),'标题\n\n正文 加粗\n下一行\n\n一\n\n二');
  assertNewspicText(m.imageMessageText('<p>safe</p>'));
  const hostile='<!-- hidden --><p>实体 &lt;tag&gt; &amp;mdash;</p><p>**粗体** [链接](https://example.com)</p>\\n# 标题\\n- 列表\\n<div>literal <broken';
  const text=m.imageMessageText(hostile);
  assert.match(text,/实体/); assert.match(text,/粗体/); assert.match(text,/标题/); assert.match(text,/列表/);
  assert.match(text,/链接/); assert.doesNotMatch(text,/https:\/\/example\.com|\\[|\\]\(/);
  assertNewspicText(text);
});
test('actual newspic draft fixture produces clean final wire content',async()=>{
  const source=await fs.readFile('/Users/chenjie/.openclaw/workspace-main/wx_mp/outputs/ai下任务四要素/note.md','utf8');
  const {body}=m.parseFrontmatter(source);
  const content=m.imageMessageText(m.markdownPlainText(body));
  m.validateNewspicContent(content);
  assert.equal(Buffer.byteLength(content,'utf8'),3111);
  assert.doesNotMatch(content,/[<>&]|<!--[\\s\\S]*?(?:-->|$)/);
  assert.deepEqual([...content].filter(ch=>{const n=ch.codePointAt(0);return (n<32&&n!==10&&n!==13)||n===127||(n>=128&&n<=159);}),[]);
  assert.doesNotMatch(content,/(^|\n)\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s+)|[*_~`]|!?\[[^\]]*\]\([^)]*\)/);
});
test('image_list dry-run needs no CSS or credentials and preserves image mode',async()=>{const dir=await fs.mkdtemp(path.join(root,'image-list-dry-'));await fs.writeFile(path.join(dir,'1.jpg'),'one');await fs.writeFile(path.join(dir,'a.md'),'---\ntitle: Carousel\nimage_list:\n  - 1.jpg\n---\n\nignored');let calls=0;const out=await m.publishDraft({markdownPath:path.join(dir,'a.md'),dryRun:true,http:async()=>{calls++;throw Error('network');}});assert.equal(out.dryRun,true);assert.equal(out.imageList,true);assert.deepEqual(out.images,['1.jpg']);assert.equal(calls,0);});

test('errors redact secret/token and explain whitelist',()=>{const redacted=m.safeError(new Error('secret=hide access_token=token media_id=private-draft'));assert.doesNotMatch(redacted,/hide|=token|private-draft/);assert.match(redacted,/\*\*\*/);assert.match(m.wxHint(40164),/白名单/);assert.match(m.wxHint(40013),/AppID/);assert.match(m.wxHint(40125),/AppSecret/);});
test('dry-run never reads credentials or invokes HTTP, and group publish is absent',async()=>{const dir=await fs.mkdtemp(path.join(root,'dry-'));await fs.writeFile(path.join(dir,'cover.jpg'),'c');await fs.writeFile(path.join(dir,'a.md'),'---\ntitle: T\ncover: cover.jpg\n---\n\ntext');let calls=0;const out=await m.publishDraft({markdownPath:path.join(dir,'a.md'),dryRun:true,http:async()=>{calls++;throw Error('network');},cssPath:css});assert.equal(out.dryRun,true);assert.equal(calls,0);const source=await fs.readFile(new URL('../scripts/direct_wx_mp.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/freepublish\/submit|message\/mass\/send|mass\/send/);});

test('direct update posts official payload with index zero and never calls draft add',async()=>{await account();const dir=await fs.mkdtemp(path.join(root,'update-'));await fs.writeFile(path.join(dir,'a.jpg'),'a');await fs.writeFile(path.join(dir,'cover.jpg'),'c');await fs.writeFile(path.join(dir,'a.md'),'---\ntitle: Updated\ncover: cover.jpg\n---\n\n![x](a.jpg)');const seen=[];const http=async(url,options={})=>{seen.push([url.pathname,options]);if(url.pathname==='/cgi-bin/token')return response({access_token:'token',expires_in:7200});if(url.pathname==='/cgi-bin/media/uploadimg')return response({url:'https://m.wx/a.jpg'});if(url.pathname==='/cgi-bin/material/add_material')return response({media_id:'new-thumb'});if(url.pathname==='/cgi-bin/draft/update')return response({errcode:0});throw Error('unexpected '+url.pathname);};const old='7BPHzGM9N_334Z1JfDAV9LZGdWKKf2qpwT4eC4XZYH9b99LWKO7wc_NDH-wsrnyQ';const out=await m.publishDraft({markdownPath:path.join(dir,'a.md'),http,cssPath:css,updateMediaId:old});assert.equal(out.updated,true);assert.equal(out.media_id,old);assert.deepEqual(seen.map(x=>x[0]).slice(-3),['/cgi-bin/media/uploadimg','/cgi-bin/material/add_material','/cgi-bin/draft/update']);assert.ok(!seen.some(x=>x[0]==='/cgi-bin/draft/add'));const payload=JSON.parse(seen.at(-1)[1].body);assert.equal(payload.media_id,old);assert.equal(payload.index,0);assert.equal(Array.isArray(payload.articles),false);assert.equal(payload.articles.thumb_media_id,'new-thumb');assert.deepEqual(Object.keys(payload.articles).sort(),['content','need_open_comment','only_fans_can_comment','thumb_media_id','title']);});
test('payload schema is useful for 47001 diagnosis without leaking article text or media IDs',()=>{const sensitive={media_id:'private-old-draft',index:0,articles:{title:'Private title',thumb_media_id:'new-thumb',content:'Private article body'}};const schema=m.payloadSchema(sensitive);assert.equal(schema.fields.articles.type,'object');assert.equal(schema.fields.articles.fields.content.length,20);assert.match(schema.fields.articles.fields.content.sha256,/^[a-f0-9]{64}$/);assert.doesNotMatch(JSON.stringify(schema),/Private|private-old|new-thumb/);});
test('debug schema is emitted before a 47001 response without leaking payload values',async()=>{await account();const dir=await fs.mkdtemp(path.join(root,'debug-'));await fs.writeFile(path.join(dir,'cover.jpg'),'c');await fs.writeFile(path.join(dir,'a.md'),'---\ntitle: Private title\ncover: cover.jpg\n---\n\nPrivate article body');let snapshot;const http=async(url,options={})=>{if(url.pathname==='/cgi-bin/token')return response({access_token:'token',expires_in:7200});if(url.pathname==='/cgi-bin/material/add_material')return response({media_id:'new-thumb'});if(url.pathname==='/cgi-bin/draft/update')return response({errcode:47001,errmsg:'data format error'});throw Error('unexpected '+url.pathname);};await assert.rejects(m.publishDraft({markdownPath:path.join(dir,'a.md'),http,cssPath:css,updateMediaId:'private-old-draft',debugSchema:true,onDebugSchema:s=>{snapshot=s;}}),/47001/);assert.equal(snapshot.fields.articles.type,'object');assert.doesNotMatch(JSON.stringify(snapshot),/Private|private-old|new-thumb|token/);});
test('update dry-run makes no network request and redacts its plan',async()=>{const dir=await fs.mkdtemp(path.join(root,'update-dry-'));await fs.writeFile(path.join(dir,'cover.jpg'),'c');await fs.writeFile(path.join(dir,'a.md'),'---\ntitle: T\ncover: cover.jpg\n---\n\ntext');let calls=0;const out=await m.publishDraft({markdownPath:path.join(dir,'a.md'),dryRun:true,http:async()=>{calls++;throw Error('network');},cssPath:css,updateMediaId:'abcdefghijklmnopqrst'});assert.equal(calls,0);assert.equal(out.updateMediaId,'abcdef…opqrst');assert.equal(out.dryRun,true);});

test('Unicode-adjacent CommonMark inline syntax renders with theme styles',async()=>{
  const input='中文**第一段 strong**紧接中文，__第二段__标点。又有 *emphasis*、_斜体_、`a ** b`、[普通链接](https://example.com/path?q=1) 和 \\*\\*转义\\*\\*。';
  const html=await m.renderMarkdown(input,css);
  assert.doesNotMatch(html,/\*\*第一段|__第二段__/);
  assert.equal((html.match(/<strong\b/g)||[]).length,2);
  assert.equal((html.match(/<strong\b[^>]*\bstyle=/g)||[]).length,2);
  assert.match(html,/<em\b[^>]*\bstyle=/);
  assert.match(html,/<code\b[^>]*\bstyle=[^>]*>a \*\* b<\/code>/);
  assert.match(html,/<a\b[^>]*href="https:\/\/example\.com\/path\?q=1"[^>]*style=/);
  assert.match(html,/\*\*转义\*\*/);
});

test('image alt is not parsed as inline Markdown and frontmatter stays out of body',async()=>{
  const source='---\ntitle: Secret FM Title\ncover: cover.jpg\n---\n\n正文 ![**alt stays literal**](figure.jpg)';
  const parsed=m.parseFrontmatter(source);
  const html=await m.renderMarkdown(parsed.body,css);
  assert.doesNotMatch(html,/Secret FM Title|cover\.jpg/);
  assert.match(html,/<img\b[^>]*alt="\*\*alt stays literal\*\*"/);
  assert.doesNotMatch(html,/<strong[^>]*>alt stays literal<\/strong>/);
});

test('render sanitizes active HTML, event handlers, unsafe URLs, and style injection',async()=>{
  const html=await m.renderMarkdown('<script>alert(1)</script>\n\n<style>body{display:none}</style>\n\n<img src="javascript:alert(1)" onerror="alert(1)" style="background:url(javascript:alert(1))"><a href="javascript:alert(1)" onclick="alert(1)">bad</a>\n\n**safe**',css);
  assert.doesNotMatch(html,/<(?:script|style|iframe|object|svg)\b|\son\w+=|javascript\s*:|url\s*\(/i);
  assert.match(html,/<strong\b[^>]*\bstyle=[^>]*>safe<\/strong>/);
});

test('inline render snapshot has no literal strong delimiters and keeps styles inline',async()=>{
  const html=await m.renderMarkdown('前文**中文 bold**后文；另一个 **English strong!**。链接 [OpenAI](https://openai.com)。\n\n![普通图片说明](figure.jpg)',css);
  const snapshot={doubleStar:(html.match(/\*\*/g)||[]).length,strong:(html.match(/<strong\b/g)||[]).length,styledStrong:(html.match(/<strong\b[^>]*\bstyle=/g)||[]).length,styleTags:(html.match(/<style\b/gi)||[]).length};
  assert.deepEqual(snapshot,{doubleStar:0,strong:2,styledStrong:2,styleTags:0});
});

test('safe raw HTML component keeps native text and discovers/uploads its local image',async()=>{
  await account();
  const dir=await fs.mkdtemp(path.join(root,'raw-component-'));
  await fs.writeFile(path.join(dir,'frontier-world-footer-logo.png'),'logo');
  await fs.writeFile(path.join(dir,'cover.jpg'),'cover');
  const component='<section class="fw-footer" aria-label="Frontier World 品牌信息"><div class="fw-footer__identity"><img class="fw-footer__logo" src="frontier-world-footer-logo.png" alt="Frontier World Logo"><div><p class="fw-footer__brand">FRONTIER WORLD</p><p class="fw-footer__meta">前沿之境 · <a class="fw-footer__domain" href="https://frontierworld.ai">frontierworld.ai</a></p></div></div><p class="fw-footer__promise">不追每一条AI新闻，只解释真正影响普通人的变化。</p></section>';
  await fs.writeFile(path.join(dir,'a.md'),`---\ntitle: Footer\ncover: cover.jpg\n---\n\n正文 **strong**\n\n${component}`);
  assert.deepEqual(m.localImageNames(component),['frontier-world-footer-logo.png']);
  const seen=[];
  const http=async(url,options={})=>{seen.push([url.pathname,options]);if(url.pathname==='/cgi-bin/token')return response({access_token:'token',expires_in:7200});if(url.pathname==='/cgi-bin/media/uploadimg')return response({url:'https://m.wx/frontier-logo.png'});if(url.pathname==='/cgi-bin/material/add_material')return response({media_id:'thumb'});if(url.pathname==='/cgi-bin/draft/add')return response({media_id:'draft'});throw Error('unexpected '+url.pathname);};
  const out=await m.publishDraft({markdownPath:path.join(dir,'a.md'),http,cssPath:css});
  const payload=JSON.parse(seen.at(-1)[1].body),html=payload.articles[0].content;
  assert.equal(out.media_id,'draft');
  assert.match(html,/class="fw-footer"[^>]*style=/);
  assert.match(html,/src="https:\/\/m\.wx\/frontier-logo\.png"/);
  assert.match(html,/class="fw-footer__domain"/);
  assert.doesNotMatch(html,/wxmp-inline-boundary|class="footnote|\[1\]/);
  for(const text of ['FRONTIER WORLD','前沿之境','frontierworld.ai','不追每一条AI新闻，只解释真正影响普通人的变化。']) assert.match(html,new RegExp(text));
  assert.doesNotMatch(html,/\[frontierworld\.ai\]|\]\(https:\/\/frontierworld\.ai\)|&lt;section|<style\b|<script\b/i);
  assert.match(html,/<strong\b[^>]*style=/);
});

test('raw HTML allowlist strips disallowed wrappers, handlers, and unsafe URLs without weakening XSS protection',async()=>{
  const html=await m.renderMarkdown('<section class="safe" onclick="evil()"><div aria-label="ok"><img src="javascript:evil()" onerror="evil()"><a href="data:text/html,evil">link text</a><iframe src="https://evil.example">secret frame</iframe><custom-tag>kept text</custom-tag></div></section>',css);
  assert.match(html,/class="safe"/);
  assert.match(html,/aria-label="ok"/);
  assert.match(html,/>link text<|>kept text</);
  assert.doesNotMatch(html,/<iframe|<custom-tag|onclick|onerror|javascript:|data:text\/html|secret frame/i);
});
