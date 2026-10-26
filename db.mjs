export async function database() {
  let get, put, close;
  if(process.env.DATABASE_URL) {
    const {default:pg}=await import('pg');
    const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
    await pool.query('CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, payload JSONB NOT NULL)');
    get=async()=> (await pool.query('SELECT payload FROM snapshots WHERE id=1')).rows[0]?.payload;
    put=async payload=>{await pool.query('INSERT INTO snapshots(id,payload) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload',[JSON.stringify(payload)]);};
    close=()=>pool.end();
  } else {
    if(process.env.NODE_ENV==='production') throw Error('DATABASE_URL ontbreekt');
    const {DatabaseSync}=await import('node:sqlite');
    const db=new DatabaseSync(process.env.SQLITE_PATH||'local.sqlite');
    db.exec('CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY,payload TEXT NOT NULL)');
    get=async()=>{const row=db.prepare('SELECT payload FROM snapshots WHERE id=1').get();return row?JSON.parse(row.payload):undefined;};
    put=async payload=>{db.prepare('INSERT INTO snapshots VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(payload));};
    close=()=>db.close();
  }
  return {get,put,close};
}
