const Storage = require('@google-cloud/storage');

const storage = Storage({
  projectId: 'julian-phd',
  keyFilename:'./testkey.json'
});

const data = storage.bucket('pubsite_prod_rev_14876298819229479527');

data.get().then(data => console.log(data));