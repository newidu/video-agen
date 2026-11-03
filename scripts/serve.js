#!/usr/bin/env node
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || process.argv[2] || 4173);
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.md':'text/markdown; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
http.createServer((req,res)=>{
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname === '/') pathname = '/ui/';
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file,(err,data)=>{
    if (err) { res.writeHead(err.code==='ENOENT'?404:500); return res.end(err.code==='ENOENT'?'Not found':'Read error'); }
    res.writeHead(200,{'content-type':types[path.extname(file).toLowerCase()]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':'no-store'});
    res.end(data);
  });
}).listen(port,'127.0.0.1',()=>console.log(`AI Video Agent UI: http://127.0.0.1:${port}/ui/`));
