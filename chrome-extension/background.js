chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === "FETCH_IMAGE") {
    fetchImageAsDataUrl(msg.url)
      .then(function (dataUrl) {
        sendResponse({ dataUrl: dataUrl });
      })
      .catch(function (err) {
        sendResponse({ error: err.message });
      });
    return true;
  }
});

async function fetchImageAsDataUrl(url) {
  var response = await fetch(url);
  if (!response.ok) throw new Error("Fetch failed: " + response.status);
  var blob = await response.blob();
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onloadend = function () {
      resolve(reader.result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
