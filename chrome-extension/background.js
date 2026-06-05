// Fix CORS issues: some CDNs (e.g. Abercrombie) send invalid
// Access-Control-Allow-Origin headers. Strip and replace them
// so the service worker fetch succeeds.
var RULE_ID = 1;
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [RULE_ID],
  addRules: [{
    id: RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [
        { header: "Access-Control-Allow-Origin", operation: "set", value: "*" },
        { header: "Access-Control-Allow-Methods", operation: "set", value: "GET" },
      ],
    },
    condition: {
      initiatorDomains: [chrome.runtime.id],
      resourceTypes: ["xmlhttprequest"],
    },
  }],
});

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
  var response = await fetch(url, { credentials: "omit" });
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
