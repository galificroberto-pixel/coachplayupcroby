// Coach Play Up – lettura del testo dalle foto, tutta sul dispositivo (Tesseract, senza internet)
let mod = null, api = null;
const SIMD = (() => { try { return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11])); } catch { return false; } })();
async function gunzip(buf){
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(ds)).arrayBuffer());
}
async function ready(){
  if (api) return;
  importScripts(SIMD ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js');
  mod = await TesseractCore();
  const gz = await (await fetch('eng.traineddata.gz')).arrayBuffer();
  mod.FS.writeFile('eng.traineddata', await gunzip(gz));
  api = new mod.TessBaseAPI();
  if (api.Init(null, 'eng')) throw new Error('init');
}
self.onmessage = async e => {
  const {id, cmd, image} = e.data;
  try {
    await ready();
    if (cmd === 'recognize'){
      mod.FS.writeFile('/input', new Uint8Array(image));
      api.SetImageFile();
      const text = api.GetUTF8Text();
      self.postMessage({id, text});
    } else self.postMessage({id, text: ''});
  } catch (err){ self.postMessage({id, error: String(err && err.message || err)}); }
};
