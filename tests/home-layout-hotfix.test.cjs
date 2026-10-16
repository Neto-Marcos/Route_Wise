const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {apply,version}=require('../scripts/apply-home-layout-hotfix.cjs');
function fixture(t, html='<link href="/_next/static/css/first.css"><link href="/_next/static/css/last.css">'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'criar-rota-hotfix-'));
  t.after(()=>{if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('criar-rota-hotfix-'))throw Error('Invalid cleanup path');fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'.next/server/app'),{recursive:true});fs.mkdirSync(path.join(root,'.next/static/css'),{recursive:true});
  fs.writeFileSync(path.join(root,'.next/server/app/index.html'),html);fs.writeFileSync(path.join(root,'.next/server/app/index.rsc'),'asset:last.css');fs.writeFileSync(path.join(root,'.next/static/css/first.css'),'first{}');fs.writeFileSync(path.join(root,'.next/static/css/last.css'),'last{}');return root;
}
test('preserves original assets and backs up HTML/RSC while adding a new CSS URL',t=>{
  const root=fixture(t);const result=apply(root);assert.equal(result.changed,true);
  assert.equal(fs.readFileSync(path.join(root,'.next/static/css/last.css'),'utf8'),'last{}');
  assert.match(fs.readFileSync(path.join(root,'.next/static/css',result.css),'utf8'),/max-width: none !important/);
  assert.equal(fs.readFileSync(path.join(root,'.next/server/app/index.rsc'),'utf8'),'asset:'+result.css);
  assert.equal(fs.readFileSync(path.join(root,'.next/ui-hotfix-backups',version,'index.rsc'),'utf8'),'asset:last.css');
  assert.match(fs.readFileSync(path.join(root,'.next/server/app/index.html'),'utf8'),/first\.css/);
});
test('is idempotent across restarts',t=>{const root=fixture(t);apply(root);assert.equal(apply(root).changed,false);});
test('refuses unrecognized root HTML rather than modifying the artifact',t=>{const root=fixture(t,'<html>no styles</html>');assert.throws(()=>apply(root),/No root CSS/);assert.equal(fs.readFileSync(path.join(root,'.next/server/app/index.html'),'utf8'),'<html>no styles</html>');});
