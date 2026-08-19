const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('database/finance.db');
db.serialize(()=>{
  db.all("SELECT name FROM sqlite_master WHERE type='table'", (e,tables)=>{
    if(e){ console.log('ERR', e.message); process.exit(1); }
    console.log('TABLES:', JSON.stringify(tables.map(t=>t.name)));
    if(tables.length===0){ process.exit(0); }
    let left=tables.length;
    tables.forEach(t=>{
      db.all("PRAGMA table_info("+t.name+")", (e,info)=>{
        db.get("SELECT COUNT(*) AS c FROM "+t.name, (e2,row)=>{
          console.log('  table='+t.name, 'cols='+JSON.stringify(info.map(c=>c.name)), 'rows='+(row?row.c:0));
          if(--left===0) process.exit(0);
        });
      });
    });
  });
});
