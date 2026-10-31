import assert from 'node:assert/strict';
import {Pool} from 'pg';
const sourceUrl=new URL(process.env.SIGNAGE_TEST_DATABASE_URL||'http://invalid');
if(sourceUrl.pathname!=='/signage_validation')throw new Error('Use the disposable signage_validation database.');
const restoreUrl=new URL(sourceUrl);restoreUrl.pathname='/signage_restore_validation';
const source=new Pool({connectionString:sourceUrl.href}),restored=new Pool({connectionString:restoreUrl.href});
try{
 const sql=`SELECT jsonb_build_object(
  'shows',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM signage_shows s),
  'displays',(SELECT jsonb_agg(to_jsonb(d) ORDER BY id) FROM signage_displays d),
  'schedules',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM signage_schedules s),
  'media',(SELECT jsonb_agg(jsonb_build_object('id',id,'size',size,'hash',encode(sha256(data),'hex')) ORDER BY id) FROM signage_media),
  'references',(SELECT jsonb_agg(to_jsonb(r) ORDER BY show_id,media_id) FROM signage_show_media r),
  'accounts',(SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM app_users u WHERE is_service_user),
  'migrations',(SELECT jsonb_agg(version ORDER BY version) FROM schema_migrations)
 ) AS snapshot`;
 const [a,b]=await Promise.all([source.query(sql),restored.query(sql)]);
 assert.ok(a.rows[0].snapshot.shows?.length,'Create the published-media backup fixture with test-signage.mjs first.');
 assert.deepEqual(b.rows[0].snapshot,a.rows[0].snapshot);
 console.log('Backup/restore checks passed: published content, schedules, media bytes, references, display identities, and migration history.');
}finally{await source.end();await restored.end();}
