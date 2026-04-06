# Steps To Run

1. Start MongoDB in WSL:

```bash
sudo pkill mongod || true
sudo mongod --dbpath /var/lib/mongodb --logpath /var/log/mongodb/mongod.log --fork --bind_ip_all
```

1. Verify MongoDB is alive:

```bash
/home/mohx-nova/filesure-assign/.venv/bin/python - <<'PY'
from pymongo import MongoClient
client = MongoClient('mongodb://localhost:27017/', serverSelectionTimeoutMS=3000)
print(client.admin.command('ping'))
client.close()
PY
```

Expected:

```json
{'ok': 1.0}
```

1. Verify the data is in local MongoDB:

```bash
/home/mohx-nova/filesure-assign/.venv/bin/python - <<'PY'
from pymongo import MongoClient
client = MongoClient('mongodb://localhost:27017/', serverSelectionTimeoutMS=3000)
print({'count': client['filesure']['companies'].count_documents({})})
client.close()
PY
```

Expected:

```json
{'count': 80}
```

1. Start the API in terminal 1:

```bash
cd /home/mohx-nova/filesure-assign
npm start
```

1. In terminal 2, verify the API is using MongoDB:

```bash
curl http://localhost:3000/health
curl 'http://localhost:3000/companies?page=1&limit=3'
```

1. Open Compass and verify `filesure.companies` has 80 documents.
