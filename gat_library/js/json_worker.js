self.onmessage = function (e) {
  const { id, type, payload } = e.data;

  try {
    if (type === 'parse') {
      const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
      self.postMessage({ id, ok: true, data: parsed });
      return;
    }

    if (type === 'stringify') {
      const text = JSON.stringify(payload, null, 2);
      self.postMessage({ id, ok: true, data: text });
      return;
    }

    self.postMessage({
      id,
      ok: false,
      error: `Unsupported worker action: ${type}`
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error?.message || 'Worker error'
    });
  }
};
