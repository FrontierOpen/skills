#!/usr/bin/env node
/** Official WeChat draft-only publisher. Intentionally contains no freepublish endpoint. */
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createWenyanCore } from '@wenyan-md/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = process.env.WX_MP_PUBLISHER_STATE_DIR || path.join(os.homedir(), '.openclaw', 'wx-mp-publisher');
const ACCOUNTS_FILE = path.join(STATE_DIR, 'accounts.json');
const TOKEN_FILE = path.join(STATE_DIR, 'token-cache.json');
const API = 'https://api.weixin.qq.com';
const TOKEN_SKEW_SECONDS = 300;
const allowedEndpoints = new Set(['/cgi-bin/token', '/cgi-bin/media/uploadimg', '/cgi-bin/material/add_material', '/cgi-bin/draft/add', '/cgi-bin/draft/update']);

export function redact(value) {
  return String(value || '').replace(/(access_token|secret|appsecret)=([^&\s]+)/gi, '$1=***')
    .replace(/(access_token|appSecret|media_id)\s*[:=]\s*["']?[^\s,"'}]+/gi, '$1=***')
    .replace(/(["']media_id["']\s*:\s*["'])[^"']+(["'])/gi, '$1***$2');
}
export function safeError(error) { return redact(error instanceof Error ? error.message : String(error)); }
export function redactMediaId(mediaId) {
  const value=String(mediaId || '');
  return value.length <= 12 ? '***' : `${value.slice(0,6)}…${value.slice(-6)}`;
}
/** A diagnostic representation which deliberately never includes article text, IDs, or credentials. */
export function payloadSchema(value) {
  if (Array.isArray(value)) return {type:'array',length:value.length,items:value.map(payloadSchema)};
  if (value === null) return {type:'null'};
  if (typeof value === 'string') return {type:'string',length:Buffer.byteLength(value,'utf8'),sha256:crypto.createHash('sha256').update(value,'utf8').digest('hex')};
  if (typeof value === 'object') return {type:'object',fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,payloadSchema(item)]))};
  return {type:typeof value};
}
export function wxHint(code, message = '') {
  const hints = {40164:'IP 未加入公众号「API IP 白名单」。请以请求实际公网出口 IP 为准，VPN/代理会改变出口。',40013:'AppID 无效：请核对 accounts.json 中 appId。',40125:'AppSecret 无效：请在公众号后台重置/核对 AppSecret。',45009:'接口调用频率受限，请稍后再试。',40007:'素材/媒体 ID 无效。',45028:'素材格式或大小不符合微信限制。',45110:'图文素材字段不符合微信限制。',45166:'图片消息 newspic 的 content 仅支持纯文本及少数特殊标签，不能提交普通图文 HTML。'};
  return `微信 API ${code}${message ? `: ${message}` : ''}${hints[code] ? `。${hints[code]}` : '。请检查微信公众平台的素材/草稿限制。'}`;
}
async function chmod600(file) { try { await fs.chmod(file, 0o600); } catch {} }
export async function atomicJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive:true, mode:0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), {encoding:'utf8', mode:0o600});
  await fs.rename(tmp, file); await chmod600(file);
}
export async function loadAccount(alias) {
  let cfg; try { cfg = JSON.parse(await fs.readFile(ACCOUNTS_FILE, 'utf8')); } catch { throw new Error(`未找到或无法解析公众号凭据文件 accounts.json：${ACCOUNTS_FILE}`); }
  const accounts = cfg.accounts || [];
  const item = alias ? accounts.find(x=>x.alias===alias) : (accounts.find(x=>x.alias===cfg.default) || (accounts.length===1 ? accounts[0] : null));
  if (!item || !item.appId || !item.appSecret) throw new Error('目标账号缺少 appId 或 appSecret；请按 REFERENCE.md 配置实例态 accounts.json。');
  return item;
}
export async function getToken(account, http=fetch, now=Date.now) {
  try { const cache=JSON.parse(await fs.readFile(TOKEN_FILE,'utf8')); const row=cache[account.appId]; if (row?.access_token && row.expires_at > now()+TOKEN_SKEW_SECONDS*1000) return row.access_token; } catch {}
  const url = new URL('/cgi-bin/token', API); url.searchParams.set('grant_type','client_credential'); url.searchParams.set('appid',account.appId); url.searchParams.set('secret',account.appSecret);
  const response=await http(url); const data=await response.json();
  if (!response.ok || data.errcode) throw new Error(wxHint(data.errcode || response.status, data.errmsg));
  if (!data.access_token || !data.expires_in) throw new Error('微信 token 响应缺少 access_token/expires_in');
  let cache={}; try { cache=JSON.parse(await fs.readFile(TOKEN_FILE,'utf8')); } catch {}
  cache[account.appId]={access_token:data.access_token, expires_at:now()+Number(data.expires_in)*1000, cached_at:now()}; await atomicJson(TOKEN_FILE,cache); return data.access_token;
}
export function parseFrontmatter(markdown) {
  if (!markdown.startsWith('---\n')) throw new Error('文章必须以 YAML frontmatter 开头并包含 title。');
  const end=markdown.indexOf('\n---', 4); if(end<0) throw new Error('frontmatter 未闭合。');
  const fm={}; let listKey=null;
  for(const line of markdown.slice(4,end).split('\n')) {
    const item=line.match(/^\s+-\s+(.+)$/);
    if(item && listKey) { let v=item[1].trim(); if(/^['"].*['"]$/.test(v))v=v.slice(1,-1); fm[listKey].push(v); continue; }
    const m=line.match(/^([A-Za-z_]+):\s*(.*)$/); if(!m) { listKey=null; continue; }
    let v=m[2].trim(); if(/^['"].*['"]$/.test(v))v=v.slice(1,-1);
    if(!v && m[1]==='image_list') { fm.image_list=[]; listKey='image_list'; continue; }
    fm[m[1]]=/^(true|false)$/i.test(v)?v.toLowerCase()==='true':v; listKey=null;
  }
  if(!fm.title) throw new Error('frontmatter 必须包含 title。'); return {frontmatter:fm, body:markdown.slice(end+4).replace(/^\n/,'')};
}
export function localImageNames(markdown) {
  const names=[...markdown.matchAll(/!\[[^\]]*\]\(([^\s)]+)/g)].map(x=>x[1]);
  // Raw HTML is accepted only through the sanitizer below. Discover its image
  // sources as well so a safe component uses the normal upload pipeline.
  const fragment=JSDOM.fragment(markdown);
  for(const image of fragment.querySelectorAll('img[src]')) { const src=image.getAttribute('src'); if(safeUrl(src,{image:true})!==null)names.push(src); }
  return [...new Set(names.filter(Boolean).filter(x=>!/^https?:\/\//i.test(x)&&!/^data:/i.test(x)))];
}

// marked@15 (used by WenYan 3.0.11) applies ASCII-only delimiter flanking
// rules. A closing ** immediately followed by a CJK letter is therefore left
// as literal Markdown. An inert HTML comment gives marked a punctuation
// boundary without adding visible whitespace. Images are copied verbatim so
// Markdown-looking alt text never becomes body markup.
const INLINE_BOUNDARY='<!--wxmp-inline-boundary-->';
const LETTER_OR_NUMBER=/[\p{L}\p{N}]/u;
function closingBracket(source,start) {
  for(let i=start+1;i<source.length;i++) { if(source[i]==='\\')i++; else if(source[i]===']')return i; }
  return -1;
}
function closingParen(source,start) {
  let depth=0;
  for(let i=start;i<source.length;i++) { if(source[i]==='\\')i++; else if(source[i]==='(')depth++; else if(source[i]===')'&&--depth===0)return i; }
  return -1;
}
function closingHtmlTag(source,start) {
  let quote=null;
  for(let i=start+1;i<source.length;i++) {
    const char=source[i];
    if(quote) { if(char===quote)quote=null; else if(char==='\\')i++; continue; }
    if(char==='"'||char==="'") { quote=char; continue; }
    if(char==='>')return i;
    if(char==='\n')return -1;
  }
  return -1;
}
export function normalizeUnicodeInlineBoundaries(markdown) {
  let out='';
  for(let i=0;i<markdown.length;) {
    if(markdown[i]==='\\') { out+=markdown.slice(i,i+2); i+=Math.min(2,markdown.length-i); continue; }
    if(markdown[i]==='`') { const run=markdown.slice(i).match(/^`+/)[0]; const end=markdown.indexOf(run,i+run.length); if(end>=0){out+=markdown.slice(i,end+run.length);i=end+run.length;continue;} }
    if(markdown[i]==='<') { const end=closingHtmlTag(markdown,i); if(end>=0){out+=markdown.slice(i,end+1);i=end+1;continue;} }
    const image=markdown.startsWith('![',i), link=!image&&markdown[i]==='[';
    if(image||link) {
      const close=closingBracket(markdown,i+(image?1:0));
      if(close>=0&&markdown[close+1]==='(') {
        const end=closingParen(markdown,close+1);
        if(end>=0) {
          if(image) out+=markdown.slice(i,end+1);
          else out+=`[${normalizeUnicodeInlineBoundaries(markdown.slice(i+1,close))}]${markdown.slice(close+1,end+1)}`;
          i=end+1; continue;
        }
      }
    }
    const delimiter=['**','__','*','_'].find(value=>markdown.startsWith(value,i));
    if(delimiter) {
      let end=i+delimiter.length;
      while((end=markdown.indexOf(delimiter,end))>=0) {
        if(markdown[end-1]!=='\\'&&!markdown.slice(i+delimiter.length,end).includes('\n'))break;
        end+=delimiter.length;
      }
      const content=end>=0?markdown.slice(i+delimiter.length,end):'';
      if(end>=0&&content&& !/^\s|\s$/u.test(content)) {
        const after=markdown[end+delimiter.length];
        out+=delimiter+normalizeUnicodeInlineBoundaries(content)+delimiter;
        if(after&&LETTER_OR_NUMBER.test(after))out+=INLINE_BOUNDARY;
        i=end+delimiter.length; continue;
      }
    }
    out+=markdown[i++];
  }
  return out;
}
const ALLOWED_TAGS=new Set(['section','div','p','h1','h2','h3','h4','h5','h6','strong','em','code','pre','a','sup','span','img','blockquote','ul','ol','li','hr','br','table','thead','tbody','tr','th','td','del','i']);
const ALLOWED_ATTRS=new Set(['style','href','src','alt','title','class','id','aria-label','data-provider','start','reversed','colspan','rowspan']);
const DROP_WITH_CONTENT=new Set(['script','style','iframe','object','embed','template','svg','math','form']);
function safeUrl(value,{image=false}={}) {
  const text=String(value||'').trim();
  if(/^https?:\/\//i.test(text))return text;
  if(!image&&/^#[A-Za-z0-9_.:-]+$/.test(text))return text;
  if(image&&/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(text))return text;
  return null;
}
function sanitizeRenderedHtml(document) {
  const root=document.querySelector('#wenyan');
  const comments=[]; const walker=document.createTreeWalker(root,document.defaultView.NodeFilter.SHOW_COMMENT); while(walker.nextNode())comments.push(walker.currentNode); for(const comment of comments)comment.remove();
  for(const element of [...root.querySelectorAll('*')]) {
    const tag=element.localName;
    if(DROP_WITH_CONTENT.has(tag)){element.remove();continue;}
    if(!ALLOWED_TAGS.has(tag)){element.replaceWith(...element.childNodes);continue;}
    for(const attr of [...element.attributes]) {
      const name=attr.name.toLowerCase();
      if(!ALLOWED_ATTRS.has(name)||name.startsWith('on')){element.removeAttribute(attr.name);continue;}
      if(name==='href'||name==='src') { const safe=safeUrl(attr.value,{image:name==='src'}); if(safe===null)element.removeAttribute(attr.name); else element.setAttribute(attr.name,safe); }
      if(name==='style'&&/(?:url\s*\(|expression\s*\(|@import|javascript\s*:|behavior\s*:|-moz-binding)/i.test(attr.value))element.removeAttribute(attr.name);
    }
  }
  return root;
}
export async function renderMarkdown(body, cssPath) {
  const css=await fs.readFile(cssPath,'utf8'); const core=await createWenyanCore({mermaid:{enabled:false}}); const normalized=normalizeUnicodeInlineBoundaries(body); const raw=await core.renderMarkdown(normalized, true); const dom=new JSDOM(`<body><section id="wenyan">${raw}</section></body>`); const root=sanitizeRenderedHtml(dom.window.document);
  const result=await core.applyStylesWithTheme(root,{themeCss:css,isMacStyle:true,isAddFootnote:false});
  const clean=new JSDOM(result); return sanitizeRenderedHtml(clean.window.document).outerHTML;
}
/**
 * The official `newspic` schema does not accept article HTML in `content`:
 * unlike a `news` article it only accepts plain text (plus a few platform
 * specific special tags). Keep rich HTML for normal articles, but reduce
 * image-message prose to text before building the API payload.
 */
export function markdownPlainText(markdown) {
  let text=String(markdown||'')
    .replace(/<!--[\s\S]*?(?:-->|$)/g,'')
    .replace(/!\[[^\]]*\]\([^)]*\)/g,'')
    .replace(/<[^>]*>/g,'')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi,' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|>\s+)/gm,'')
    .replace(/```[\s\S]*?```/g,'')
    .replace(/[*_~`]/g,'')
    .replace(/\\([\\`*_[\]{}()#+.!_>-])/g,'$1')
    .replace(/\r\n?/g,'\n');
  return text.split('\n').map(line=>line.replace(/[ \t]+$/,'').trim()).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
export function imageMessageText(html) {
  const dom=new JSDOM(`<body>${html}</body>`);
  const blockTags=new Set(['address','article','aside','blockquote','div','dl','fieldset','figcaption','figure','footer','form','h1','h2','h3','h4','h5','h6','header','hr','li','main','nav','ol','p','pre','section','table','tr','ul']);
  const walk=(node)=>{
    if(node.nodeType===dom.window.Node.TEXT_NODE)return node.nodeValue || '';
    if(node.nodeType!==dom.window.Node.ELEMENT_NODE)return '';
    if(node.localName==='br'||node.localName==='hr')return '\n';
    const text=[...node.childNodes].map(walk).join('');
    return blockTags.has(node.localName) ? `\n${text}\n` : text;
  };
  const text=walk(dom.window.document.body)
    .replace(/\u00a0/g,' ')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n[ \t]+/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
  // newspic content is a text-only field. The DOM walk decodes entities and
  // drops comments, but literal/malformed markup and Markdown markers can
  // still survive in text nodes. Enforce the wire-format invariant here.
  const result = text
    .replace(/<!--[\s\S]*?(?:-->|$)/g,'')
    // WeChat's newspic content hint rejects HTML delimiters and ampersands,
    // including otherwise harmless literal ampersands in prose. Keep the
    // wire value strictly text-only; image_info carries the actual images.
    .replace(/[<>&]/g,'')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi,'')
    // Keep the wire invariant even if the renderer leaves malformed or
    // literal Markdown in a text node (for example CJK-adjacent links).
    .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g,'$1')
    .replace(/(^|\n)[ \t]{0,3}(?:#{1,6}[ \t]+|[-*+][ \t]+|>[ \t]+)/g,'$1')
    .replace(/[*_~`]/g,'')
    .replace(/\\([\\`*_[\]{}()#+.!_>-])/g,'$1')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n[ \t]+/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
  validateNewspicContent(result);
  return result;
}
/**
 * Last-mile assertion for the value passed to JSON.stringify. newspic is not
 * an HTML field; reject renderer regressions locally instead of remote 45166.
 */
export function validateNewspicContent(value) {
  const text=String(value ?? '');
  if (/[<>&]/.test(text) || /<!--[\s\S]*?(?:-->|$)/.test(text)) {
    throw new Error('newspic content invariant violated: HTML delimiter/entity/comment remained');
  }
  if (/(^|\n)[ \t]{0,3}(?:#{1,6}[ \t]+|[-*+][ \t]+|>[ \t]+)/.test(text) || /[*_~`]/.test(text) || /!?\[[^\]]*\]\([^)]*\)/.test(text)) {
    throw new Error('newspic content invariant violated: Markdown syntax remained');
  }
  // Newlines are intentional; reject all other C0/C1 wire controls.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(text)) {
    throw new Error('newspic content invariant violated: control character remained');
  }
  return text;
}
/** Remove Markdown image tokens while retaining the surrounding prose.
 * image_list images are represented by image_info in a newspic article, so
 * rendering these tokens as HTML would duplicate them in the article body.
 */
export function stripMarkdownImages(markdown) {
  let out='';
  for(let i=0;i<markdown.length;) {
    if(markdown[i]==='\\') { out+=markdown.slice(i,i+2); i+=Math.min(2,markdown.length-i); continue; }
    if(markdown[i]==='`') { const run=markdown.slice(i).match(/^`+/)[0]; const end=markdown.indexOf(run,i+run.length); if(end>=0){out+=markdown.slice(i,end+run.length);i=end+run.length;continue;} }
    if(markdown.startsWith('![',i)) {
      const close=closingBracket(markdown,i+1);
      if(close>=0&&markdown[close+1]==='(') { const end=closingParen(markdown,close+1); if(end>=0){i=end+1;continue;} }
    }
    out+=markdown[i++];
  }
  return out;
}
export async function upload(http, endpoint, token, file, field='media', type='image') {
  const bytes=await fs.readFile(file); const form=new FormData(); form.append(field,new Blob([bytes]),path.basename(file)); const url=new URL(endpoint,API); url.searchParams.set('access_token',token); if(type)url.searchParams.set('type',type);
  const r=await http(url,{method:'POST',body:form}); const d=await r.json(); if(!r.ok||d.errcode)throw new Error(wxHint(d.errcode||r.status,d.errmsg)); return d;
}
export async function publishDraft({markdownPath, accountAlias, http=fetch, dryRun=false, cssPath, updateMediaId, debugSchema=false, onDebugSchema}) {
  const absolute=path.resolve(markdownPath), source=await fs.readFile(absolute,'utf8'), {frontmatter,body}=parseFrontmatter(source), dir=path.dirname(absolute);
  const imageList=Array.isArray(frontmatter.image_list) ? frontmatter.image_list : null;
  if(imageList) {
    if(imageList.length<1 || imageList.length>20) throw new Error('frontmatter image_list 必须包含 1-20 张图片。');
    for(const name of imageList) if(path.basename(name)!==name || /^https?:\/\//i.test(name)) throw new Error(`image_list 图片必须是同目录内的纯文件名：${name}`);
  }
  const refs=imageList || localImageNames(body); for(const name of refs) if(path.basename(name)!==name) throw new Error(`正文图片必须只用纯文件名：${name}`);
  const cover=frontmatter.cover; if(!imageList && (!cover||path.basename(cover)!==cover))throw new Error('frontmatter cover 必须是同目录内的纯文件名。');
  const chosenCss=cssPath || process.env.WX_MP_FRONTIER_CSS; if(!chosenCss && !imageList && !dryRun)throw new Error('未设置 frontier-editorial-blue CSS 路径。'); let html='';
  if(!dryRun && !imageList) html=await renderMarkdown(body,chosenCss);
  if(updateMediaId !== undefined && !String(updateMediaId).trim()) throw new Error('--update-media-id 必须提供有效草稿 media_id。');
  if(dryRun) return {dryRun:true,title:frontmatter.title,images:refs,cover,html,imageList:!!imageList,updateMediaId:updateMediaId ? redactMediaId(updateMediaId) : undefined};
  const account=await loadAccount(accountAlias), token=await getToken(account,http);
  if(imageList) {
    const imageMediaIds=[];
    for(const name of imageList) { const out=await upload(http,'/cgi-bin/material/add_material',token,path.join(dir,name),'media','image'); if(!out.media_id)throw new Error('图片消息永久素材上传未返回 media_id'); imageMediaIds.push(out.media_id); }
    // Official image-message schema: article_type=newspic and
    // image_info.image_list[].image_media_id. Body prose is rendered into
    // content, while Markdown image tokens are stripped to avoid duplicates.
    // Keep this as the single value used by both draft/add and draft/update.
    // The final JSON.stringify payload must never receive rendered HTML,
    // entities, Markdown, or local image paths in articles.content.
    const content=imageMessageText(markdownPlainText(body));
    const article={article_type:'newspic',title:frontmatter.title,content,image_info:{image_list:imageMediaIds.map(image_media_id=>({image_media_id}))}};
    const isUpdate=updateMediaId !== undefined;
    // draft/add accepts articles[], while draft/update requires one article
    // object together with the target draft media_id and article index.
    const payload=isUpdate ? {media_id:String(updateMediaId),index:0,articles:article} : {articles:[article]};
    const endpoint=isUpdate ? '/cgi-bin/draft/update' : '/cgi-bin/draft/add';
    const schema=debugSchema?payloadSchema(payload):undefined; if(schema&&onDebugSchema)onDebugSchema(schema);
    const url=new URL(endpoint,API);url.searchParams.set('access_token',token); const r=await http(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const d=await r.json(); if(!r.ok||d.errcode)throw new Error(wxHint(d.errcode||r.status,d.errmsg)); return {media_id:isUpdate ? String(updateMediaId) : d.media_id,payload,imageList:true,updated:isUpdate,debugSchema:schema};
  }
  for(const name of refs) { const out=await upload(http,'/cgi-bin/media/uploadimg',token,path.join(dir,name),'media',null); if(!out.url)throw new Error('正文图片上传未返回 url'); html=html.replaceAll(`src=\"${name}\"`,`src=\"${out.url}\"`); }
  const thumb=await upload(http,'/cgi-bin/material/add_material',token,path.join(dir,cover),'media','image'); if(!thumb.media_id)throw new Error('封面永久素材上传未返回 media_id');
  const article={title:frontmatter.title,thumb_media_id:thumb.media_id,content:html,need_open_comment:!!frontmatter.need_open_comment,only_fans_can_comment:!!frontmatter.only_fans_can_comment};
  if(frontmatter.author)article.author=frontmatter.author;
  const isUpdate=!!updateMediaId;
  // Official schemas differ here: draft/add accepts articles[], while draft/update
  // requires one articles object for the selected index. Sending the add shape to
  // update is rejected by WeChat as 47001 (data format error).
  const payload=isUpdate ? {media_id:String(updateMediaId),index:0,articles:article} : {articles:[article]};
  const endpoint=isUpdate ? '/cgi-bin/draft/update' : '/cgi-bin/draft/add';
  const schema=debugSchema?payloadSchema(payload):undefined;
  // Emit before the request so a 47001 response still has a safely redacted payload snapshot.
  if(schema && onDebugSchema) onDebugSchema(schema);
  const url=new URL(endpoint,API);url.searchParams.set('access_token',token); const r=await http(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); const d=await r.json(); if(!r.ok||d.errcode)throw new Error(wxHint(d.errcode||r.status,d.errmsg)); return {media_id:isUpdate ? String(updateMediaId) : d.media_id,payload,updated:isUpdate,debugSchema:schema};
}
function arg(name){const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];}
async function main(){const file=process.argv[2];if(!file)throw new Error('用法：wx-mp-publisher <markdown_file> [theme] --transport direct [--account ALIAS] [--update-media-id ID] [--dry-run] [--debug-schema]');if(process.argv.includes('--transport')&&arg('--transport')!=='direct')throw new Error('direct helper 只能用于 --transport direct'); const css=process.env.WX_MP_FRONTIER_CSS || path.join(os.homedir(), '.openclaw', 'workspace-main', 'wx_mp', 'wenyan-theme', 'frontier-editorial-blue.css'); const debugSchema=process.argv.includes('--debug-schema'); const out=await publishDraft({markdownPath:file,accountAlias:arg('--account'),dryRun:process.argv.includes('--dry-run'),cssPath:css,updateMediaId:arg('--update-media-id'),debugSchema,onDebugSchema:debugSchema?(schema=>console.log(`debug payload schema: ${JSON.stringify(schema)}`)):undefined}); if(out.dryRun)console.log(`✓ dry-run 完成：${out.title}（${out.images.length} 张正文图）；${out.updateMediaId ? `将覆盖草稿 ${out.updateMediaId} 的第 0 篇文章，并替换封面/正文图；` : ''}未读取凭据、未发起任何微信 API 请求。`);else {console.log(out.updated ? `✓ 已覆盖公众号草稿箱草稿\n  media_id: ${out.media_id}\n  index: 0` : `✓ 草稿已推入公众号草稿箱\n  media_id: ${out.media_id}`);}}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`✗ ${safeError(e)}`);process.exit(1);});
