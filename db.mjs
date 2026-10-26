export async function database() {
  let get, put, close, getRoyalties, updateRoyalties;
  if(process.env.DATABASE_URL) {
    const {default:pg}=await import('pg');
    const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3});
    await pool.query('CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, payload JSONB NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS royalty_state (id INTEGER PRIMARY KEY, payload JSONB NOT NULL)');
    await pool.query(`INSERT INTO royalty_state VALUES(1,'{"parties":[],"agreements":[],"settlements":[]}'::jsonb) ON CONFLICT(id) DO NOTHING`);
    getRoyalties=async()=> (await pool.query('SELECT payload FROM royalty_state WHERE id=1')).rows[0].payload;
    updateRoyalties=async change=>{const client=await pool.connect();try{await client.query('BEGIN');const state=(await client.query('SELECT payload FROM royalty_state WHERE id=1 FOR UPDATE')).rows[0].payload;const result=change(state);await client.query('UPDATE royalty_state SET payload=$1 WHERE id=1',[JSON.stringify(state)]);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}};
    get=async()=> (await pool.query('SELECT payload FROM snapshots WHERE id=1')).rows[0]?.payload;
    put=async payload=>{await pool.query('INSERT INTO snapshots(id,payload) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload',[JSON.stringify(payload)]);};
    close=()=>pool.end();
  } else {
    if(process.env.NODE_ENV==='production') throw Error('DATABASE_URL ontbreekt');
    const {DatabaseSync}=await import('node:sqlite');
    const db=new DatabaseSync(process.env.SQLITE_PATH||'local.sqlite');
    db.exec('CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY,payload TEXT NOT NULL)');
    db.exec(`CREATE TABLE IF NOT EXISTS royalty_state (id INTEGER PRIMARY KEY,payload TEXT NOT NULL); INSERT OR IGNORE INTO royalty_state VALUES(1,'{"parties":[],"agreements":[],"settlements":[]}');`);
    getRoyalties=async()=>JSON.parse(db.prepare('SELECT payload FROM royalty_state WHERE id=1').get().payload);
    updateRoyalties=async change=>{db.exec('BEGIN IMMEDIATE');try{const state=JSON.parse(db.prepare('SELECT payload FROM royalty_state WHERE id=1').get().payload);const result=change(state);db.prepare('UPDATE royalty_state SET payload=? WHERE id=1').run(JSON.stringify(state));db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
    get=async()=>{const row=db.prepare('SELECT payload FROM snapshots WHERE id=1').get();return row?JSON.parse(row.payload):undefined;};
    put=async payload=>{db.prepare('INSERT INTO snapshots VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(payload));};
    close=()=>db.close();
  }
  return {get,put,close,getRoyalties,updateRoyalties};
}
