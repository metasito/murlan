// node bench/serve.cjs <dir> <port> — a single-page static server for the spike export.
const http = require("http"), fs = require("fs"), path = require("path");
const [dir, port] = [process.argv[2], Number(process.argv[3] ?? 8099)];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".png": "image/png", ".ttf": "font/ttf" };
http.createServer((req, res) => {
  let f = path.join(dir, decodeURIComponent(req.url.split("?")[0]));
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dir, "index.html");
  res.setHeader("content-type", types[path.extname(f)] ?? "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log("serving", port));
