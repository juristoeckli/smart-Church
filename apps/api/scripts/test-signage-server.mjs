import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Pool} from 'pg';
const connectionString=process.env.SIGNAGE_TEST_DATABASE_URL;
if(!connectionString||new URL(connectionString).pathname!=='/signage_validation')throw new Error('Use the isolated database created by test-signage.mjs.');
const pool=new Pool({connectionString});
const adminKey='sc_'+'A'.repeat(43),displayKey='sc_'+'B'.repeat(43);
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=randomUUID();let child,logs='';
try{
 await pool.query("DELETE FROM app_users WHERE username='server_test_admin'");
 const display=(await pool.query('SELECT * FROM signage_displays LIMIT 1')).rows[0];assert.ok(display);
 await pool.query(`INSERT INTO app_users(id,email,username,display_name,password_hash,role,is_enabled,api_key_hash,must_change_password) VALUES($1,NULL,'server_test_admin','Test administrator','unused','server_admin',true,$2,false)`,[id,hash(adminKey)]);
 await pool.query(`INSERT INTO department_memberships(user_id,department_id,role) VALUES($1,$2,'site_admin')`,[id,display.department_id]);
 await pool.query('UPDATE app_users SET api_key_hash=$2 WHERE id=$1',[display.service_user_id,hash(displayKey)]);
 child=spawn(process.execPath,['--import','tsx','src/server.ts'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:connectionString,NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3198',SMART_CHURCH_VIDEO_STEFFISBURG_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>{logs+=chunk;});child.stderr.on('data',chunk=>{logs+=chunk;});
 let ready=false;for(let i=0;i<150;i++){try{if((await fetch('http://127.0.0.1:3198/api/health')).ok){ready=true;break;}}catch{}await delay(100);}
 assert.ok(ready,logs);
 const headers=key=>({authorization:'Bearer '+key,'x-department-id':display.department_id,'content-type':'application/json'});
 let r=await fetch('http://127.0.0.1:3198/api/installation/modules',{headers:headers(adminKey)});assert.equal(r.status,200,(await r.clone().text())+JSON.stringify((await pool.query('SELECT role,is_enabled,is_service_user,must_change_password FROM app_users WHERE api_key_hash=$1',[hash(adminKey)])).rows)+logs);const catalog=await r.json();assert.ok(catalog.modules.some(module=>module.id==='signage'&&module.version==='0.4.1'));
 r=await fetch('http://127.0.0.1:3198/api/installation/modules',{method:'PUT',headers:headers(adminKey),body:JSON.stringify({moduleIds:catalog.modules.filter(module=>module.enabled).map(module=>module.id)})});assert.equal(r.status,200,await r.clone().text());
 r=await fetch('http://127.0.0.1:3198/api/signage/device/'+display.id+'/plan',{headers:headers(displayKey)});assert.equal(r.status,200,await r.clone().text());
 r=await fetch('http://127.0.0.1:3198/api/signage/device/'+display.id+'/control-ticket',{headers:headers(displayKey)});assert.equal(r.status,200,await r.clone().text());assert.ok((await r.json()).ticket);
 r=await fetch('http://127.0.0.1:3198/api/contacts',{headers:headers(displayKey)});assert.equal(r.status,401,'Display accounts must not read core application data');
 r=await fetch('http://127.0.0.1:3198/api/signage/shows',{headers:headers(displayKey)});assert.equal(r.status,401,'Display accounts must not use management APIs');
 r=await fetch('http://127.0.0.1:3198/api/signage/media?name=Unauthenticated&type=image%2Fpng',{method:'POST',headers:{'content-type':'application/unsupported'},body:'not a file'});assert.equal(r.status,401,'Uploads must reject anonymous requests before buffering or parsing their bodies');
 const pair=(await fetch('http://127.0.0.1:3198/api/signage/displays/'+display.id+'/pairing',{method:'POST',headers:headers(adminKey),body:JSON.stringify({code:'TEST-2345'})}));
 // Management mutations require browser CSRF even when authenticated with an API key.
 assert.equal(pair.status,403);
 console.log('Server smoke checks passed: module discovery, activation, real API-key authentication, and display-only access.');
}finally{if(child){child.kill();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,5000).unref();});}await pool.end();}
