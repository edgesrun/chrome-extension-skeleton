// Production
// TODO: make sure to uncomment this when you deploy your extension
// const WEB_APP_URL = 'https://app.edges.run/';
// const API_URL = 'https://api.edges.run';

// Local
// TODO: make sure to comment this when you deploy your extension
const WEB_APP_URL = "http://localhost:4200/";
const API_URL = "http://localhost:5000";

/**
 * Updates tokens from the Chrome Local Storage.
 */
const updateTokensProcess = async (response) => {
  try {
    for (const account_uid in response.integrations) {
      if (account_uid) {
        return await updateCookies(
          response.integrations[account_uid].integration,
          account_uid,
          response.integrations[account_uid].baseUrl,
          response.integrations[account_uid].cookies,
          response.integrations
        );
      }
    }
  } catch (err) {
    console.log("Error updating tokens:", err);
  }
};

/**
 * Updates tokens.
 */
const updateTokensHandle = () => {
  chrome.storage.local.get(["integrations"], updateTokensProcess);
};

/**
 * Receives messages from your app to update various variables.
 */
async function onMessageExternal(request, sender, sendResponse) {
  if (request.message) {
    if (request.message === "msg_fetch_cookies") {
      if (request.integration && request.requestedCookies) {
        const cookies = await getCookies(
          request.account_uid,
          request.integration,
          request.baseUrl,
          request.requestedCookies,
          request.cookies
        );

        return sendResponse(cookies);
      }
    } else if (request.message === "msg_update_cookies") {
      // Note: this is mostly useless, for local development purposes & debugging
      const response = await chrome.storage.local.get(["integrations"]);
      const updatedCookies = await updateTokensProcess(response);
      return sendResponse(updatedCookies);
    } else if (request.message === "msg_update_cookies") {
      return sendResponse({
        extensionId: chrome.runtime.id,
      });
    } else if (request.message === "msg_remove_account") {
      await removeCookies(request.account_uid);
      return sendResponse({
        success: true,
      });
    }
  }

  return sendResponse({ error: "No message provided in the request." });
}

/**
 * Get cookies for a specific app (integration) on a baseUrl (domain).
 * Note: update your client code accordingly.
 * @param {*} integration
 * @param {*} baseUrl
 * @param {*} requestedCookies
 * @param {*} cookies
 * @param {*} sendResponse
 * @returns
 */
const getCookies = async (
  account_uid,
  integration,
  baseUrl,
  requestedCookies,
  cookies
) => {
  return await new Promise(async (resolve, reject) => {
    return await chrome.cookies.getAll(
      {
        url: baseUrl,
      },
      async (cookieObjects) => {
        try {
          // For every needed cookies, retrieve the valye from Chrome cookies
          // Note: for Sales Navigator accounts, make sure to require li_at AND li_a cookies
          for (const key in requestedCookies) {
            const cookie = cookieObjects.find((c) => c.name === key);
            if (cookie) {
              cookies[key] = cookie["value"];
            } else {
              cookies[key] = null;
            }
          }

          let integrations = {};
          try {
            if (account_uid) {
              integrations[account_uid] = {
                integration,
                baseUrl,
                requestedCookies,
                cookies,
              };

              chrome.storage.local.set(
                {
                  integrations,
                },
                () => {}
              );
            }
          } catch (err) {
            console.log("Error setting up local storage object:", err);
          }

          if (JSON.stringify(cookies) === "{}" || cookies === null) {
            resolve({
              error: "It appears you are not connected to LinkedIn",
            });
          } else if (
            integration === "linkedin" &&
            (!("li_at" in cookies) || ("li_at" in cookies && !cookies["li_at"]))
          ) {
            resolve({ error: "It appears you are not connected to LinkedIn" });
          }

          resolve({ cookies });
        } catch (err) {
          console.log("Error fetching cookies:", err);
          reject(err);
        }
      }
    );
  });
};

/**
 * Update cookies for a specific app (integration) on a baseUrl (domain).
 * Also compares if cookies have changed to avoid updating the same values.
 * @param {*} integration
 * @param {*} account_uid
 * @param {*} baseUrl
 * @param {*} clientCookies
 * @param {*} integrations
 * @returns
 */
const updateCookies = async (
  integration,
  account_uid,
  baseUrl,
  clientCookies,
  integrations
) => {
  return await new Promise(async (resolve, reject) => {
    return await chrome.cookies.getAll(
      {
        url: baseUrl,
      },
      async (cookieObjects) => {
        try {
          let freshCookies = {};
          // Fetching fresh cookies values from Chrome
          for (const key in clientCookies) {
            const cookie = cookieObjects.find((c) => c.name === key);
            if (cookie) {
              freshCookies[key] = cookie["value"];
            }
          }

          if (JSON.stringify(freshCookies) === "{}") {
            resolve({
              success: true,
              message: "Cookies are empty, keeping previous values.",
            });
          } else if (integration === "linkedin" && !("li_at" in freshCookies)) {
            if (
              !clientCookies ||
              (clientCookies && JSON.stringify(clientCookies) === "{}")
            ) {
              resolve({
                success: true,
                message:
                  "li_at does not exist, user might have been disconnected",
              });
            } else {
              integrations[accountUid] = {
                integration,
                baseUrl,
                cookies: {},
              };

              chrome.storage.local.set(
                {
                  integrations,
                },
                () => {}
              );

              // Enables Edges API to mark the account as invalid (since the cookies are not valid anymore)
              freshCookies = clientCookies;
            }
          } else {
            // Note: compares if cookies have changed or not; if they didn't, resolve and skip update
            let haveChanges = false;
            for (const key in freshCookies) {
              if (!(key in clientCookies)) {
                haveChanges = true;
                break;
              }

              if (
                key in clientCookies &&
                clientCookies[key] !== freshCookies[key]
              ) {
                haveChanges = true;
                break;
              }
            }

            if (!haveChanges) {
              resolve({ success: true, number_changes: 0 });
            }

            if (account_uid) {
              integrations[account_uid] = {
                integration,
                baseUrl,
                cookies: freshCookies,
              };

              chrome.storage.local.set(
                {
                  integrations,
                },
                () => {}
              );
            }
          }

          const url = `${API_URL}/accounts/${account_uid}`;
          const data = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              cookies: freshCookies,
            }),
          });

          // Note: if the account_uid does not exist (anymore) you could return a 404 from your API which would mean the account has been removed
          if (data.status === 404) {
            await removeCookies(account_uid);
          }

          resolve({ success: true });
        } catch (err) {
          console.log("Error updating cookies:", err);
          reject(err);
        }
      }
    );
  });
};

/**
 * Removing cookies :)
 * @param {*} account_uid
 * @param {*} integrations
 * @returns
 */
const removeCookies = async (account_uid, integrations) => {
  return await new Promise(async (resolve, reject) => {
    try {
      chrome.storage.local.get(["integrations"], (response) => {
        if (response.integrations) {
          integrations = response.integrations;

          if ([account_uid] in integrations) {
            delete integrations[account_uid];
          }

          chrome.storage.local.set(
            {
              integrations,
            },
            () => {}
          );
        }

        resolve(true);
      });
    } catch (err) {
      console.log(err);
      reject(err);
    }
  });
};

/**
 * Receives interal messages from the app to update various variables.
 * Note: this only used for local testing purposes with the settings/index.html page
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    return await onMessageExternal(request, sender, sendResponse);
  })();

  // Important! Return true to indicate you want to send a response asynchronously
  return true;
});

/**
 * Receives messages from your app to update various variables.
 */
chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    (async () => {
      return await onMessageExternal(request, sender, sendResponse);
    })();

    // Important! Return true to indicate you want to send a response asynchronously
    return true;
  }
);

/**
 * A simple URL redirect in a new tab.
 */
const appRedirect = () => {
  chrome.tabs.create({
    url: WEB_APP_URL,
    active: true,
  });

  return false;
};

/**
 * When user clicks the extension icon.
 */
chrome.action.onClicked.addListener(async () => {
  // return appRedirect();  // TODO: you can use this method to redirect to a URL of your choosing, for example
  return chrome.runtime.openOptionsPage();
});

/**
 * Alarm to update cookies every X minutes.
 */
chrome.alarms.onAlarm.addListener(() => {
  return updateTokensHandle();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const periodDurationMinutes = 120; // Every 2 hours :)
  return await chrome.alarms.create("updateToken", {
    periodInMinutes: periodDurationMinutes,
  });
});
