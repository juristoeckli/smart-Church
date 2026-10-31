// Optional browser-test harness. Never accepts the application's real database.
import {Pool} from 'pg';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
const connectionString=process.env.SIGNAGE_TEST_DATABASE_URL;
if(!connectionString||new URL(connectionString).pathname!=='/signage_validation')throw new Error('Use the isolated database initialized by test-signage.mjs.');
const pool=new Pool({connectionString});
try{
 const site=(await pool.query('SELECT id FROM departments LIMIT 1')).rows[0].id;
 for(const [username,role,grants] of [['signage_admin','server_admin',['admin']],['signage_operator','user',['operator']]]){
  const salt=randomBytes(16),password='SignageValidation2026!';
  const hash='scrypt$'+salt.toString('hex')+'$'+scryptSync(password,salt,64).toString('hex');
  const user=(await pool.query(`INSERT INTO app_users(id,email,username,display_name,password_hash,role,is_enabled,must_change_password,can_change_password) VALUES($1,NULL,$2,$2,$3,$4,true,false,true) ON CONFLICT(lower(username)) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id`,[randomUUID(),username,hash,role])).rows[0];
  await pool.query(`INSERT INTO department_memberships(user_id,department_id,role,module_permissions) VALUES($1,$2,'member',$3) ON CONFLICT(user_id,department_id) DO UPDATE SET module_permissions=EXCLUDED.module_permissions`,[user.id,site,JSON.stringify({signage:grants})]);
 }
 await pool.query('DELETE FROM signage_pairing_attempts');
}finally{await pool.end();}
Object.assign(process.env,{DATABASE_URL:connectionString,NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3198',SMART_CHURCH_WEB_ORIGIN:'http://127.0.0.1:5179',SMART_CHURCH_VIDEO_STEFFISBURG_ENABLED:'0'});
await import('../src/server.ts');
