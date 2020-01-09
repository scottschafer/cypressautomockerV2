/**
 * cy.testRequests(cb)
 *  Calls cb() with the entire array of requests made from the frontend to the mock server.
 *
 *  * cy.testRequests(filter, cb)
 *  Calls cb() with the array of requests where the URL contains filter.
 */

module.exports = registerAutoMockCommands;

function registerAutoMockCommands() {

  // use xhook
  let xHookPackage = null;

  // for recording or mocking:
  let currentMockFileName = null;
  let currentMockFixtureName = null;
  let currentOptions = null;
  let currentVersion = 0;

  // for recording
  let recordedApis = [];
  let apiCounter = {};

  // for mocking
  let apiKeyToMocks = {};
  let apiKeyToCallCounts = {};
  let mockArray = [];

  let completedPendingRequestsFunc = null;
  var pendingApiCount = 0;
  let automocker = null;
  

  // record an intercepted API 
  function recordTransformedObject(
    xhr,
    requestObject,
    responseObject
  ) {
    let contentType = xhr.getResponseHeader('content-type');
    if (
      contentType !== null &&
      contentType.toLowerCase().indexOf('application/json') !== -1
    ) {
      try {
        responseObject = JSON.parse(responseObject);
      } catch (e) { }
    }

    let transformedObject = {
      method: xhr.method,
      path: parseUri(xhr.url).path,
      query: parseUri(xhr.url).query,
      request: requestObject,
      response: responseObject,
      status: xhr.status,
      statusText: xhr.statusText,
      contentType: contentType
    };

    // determine the path to the fixture file
    let outPath = transformedObject.path;
    if (outPath[outPath.length - 1] === '/') {
      outPath = outPath.substr(0, outPath.length - 1);
    }
    if (outPath[0] === '/') {
      outPath = outPath.substr(1);
    }
    outPath += '.' + transformedObject.method;
    // outPath += transformedObject.query; - don't include query, as it might contain timestamp information etc
    if (apiCounter[outPath]) {
      ++apiCounter[outPath];
    } else {
      apiCounter[outPath] = 1;
    }
    transformedObject.count = apiCounter[outPath];

    outPath += apiCounter[outPath];
    if (transformedObject.contentType.indexOf('json') !== -1) {
      outPath += '.json';
    } else if (transformedObject.contentType.indexOf('text') !== -1) {
      outPath += '.txt';
    }
    transformedObject.fixturePath = currentMockFixtureName + '/' + outPath;

    recordedApis.push(transformedObject);
  }

  Cypress.Commands.add('automock', (sessionName, version, options) => {

    currentVersion = version;
    if (!xHookPackage) {
      const xHookUrl = 'https://unpkg.com/xhook@latest/dist/xhook.min.js';
      cy.request(xHookUrl)
        .then(response => {
          xHookPackage = response.body;
        });
    }

    // record or playback a mock session
    const automockRecord = Cypress.config().automocker ?
      Cypress.config().automocker.record !== false :
      true;

    const automockPlayback = Cypress.config().automocker ?
      Cypress.config().automocker.playback !== false :
      true;

    const testDirPath = './cypress/integration';
    options = setOptions(options);

    currentMockFixtureName = './cypress/fixtures/automocks/' + sessionName;

    // determine the mock file name
    if (sessionName.indexOf('.json') == -1) {
      sessionName += '.json';
    }

    currentMockFileName = testDirPath + '/../automocks/' + sessionName;

    // get the absolute path for recording purposes
    const pwd = Cypress.platform === 'win32' ? 'cd' : 'pwd';
    const ls = Cypress.platform === 'win32' ? 'dir ' : 'ls ';

    // determine if session file exists and if we should start mocking APIs or record them
    cy.exec(pwd, {
      log: false
    }).then(result => {
      const mockFilePath = result.stdout + '/cypress/automocks/' + sessionName;
      const absolutePathToMockFile =
        Cypress.platform === 'win32' ?
          mockFilePath.split('/').join('\\') :
          mockFilePath;
      // if the config allows us to replay the mock, test if it exists
      if (automockPlayback) {
        cy.exec(ls + absolutePathToMockFile, {
          failOnNonZeroExit: false,
          log: false
        }).then(result => {
          let sessionFileExists = false;
          if (result.code === 0) {
            // file exists, so mock APIs
            cy.readFile(currentMockFileName).then(contents => {
              if (contents.version === version) {
                sessionFileExists = true;
                startApiMocking(contents);
              } else {
                debugger;
                cy.exec('rm ' + absolutePathToMockFile);
              }
            });
          }

          if (!sessionFileExists) {
            // file doesn't exist, so start recording if allowed
            if (!currentOptions.isCustomMock && automockRecord) {
              startApiRecording();
            }
          }
        });
      } else if (!currentOptions.isCustomMock && automockRecord) {
        startApiRecording();
      }
    });
  });

  Cypress.Commands.add('automockEnd', () => {
    if (automocker.isRecording) {

      cy.automockWaitOnPendingAPIs().then(() => {
        automocker.isRecording = false;
      });
      // use undocumented field to determine if the test failed
      const wasError = typeof cy.state === 'function' && !!cy.state().error;
      if (!wasError) {
        if (currentMockFileName !== null && recordedApis) {
          recordedApis.version = currentVersion;

          cy.writeFile(currentMockFileName, {
            version: currentVersion,
            recordings: recordedApis
          });

          recordedApis.forEach(recordedApi => {
            let outPath = recordedApi.fixturePath;
            cy.writeFile(outPath, recordedApi.response);
          });

          currentMockFileName = null;
        } else {
          currentMockFileName = null;
        }
      }
    }
    automocker.isMocking = false;
  });

  Cypress.Commands.add('automockServer', () => {
    if (automocker.isRecording) {
      cy.server({
        // Here we handle all requests passing through Cypress' server
        onResponse: (response) => {
          if (automocker.isRecording) {
            const xhr = response.xhr;
            if (typeof xhr.response === 'object') {
              var fr = new FileReader();
              fr.onload = function (e) {
                var blobText = e.target.result;
                blobResponseObject = JSON.parse(blobText);
                let requestObject = xhr.request ?
                  JSON.parse(JSON.stringify(xhr.request)) :
                  '';
                let responseObject;
                if (!blobResponseObject) {
                  responseObject = xhr.response ?
                    JSON.parse(JSON.stringify(xhr.response)) :
                    '';
                } else {
                  responseObject = blobResponseObject;
                }
                recordTransformedObject(xhr, requestObject, responseObject);
              };
              fr.readAsText(xhr.response);
            } else {
              let requestObject = xhr.request ?
                JSON.parse(JSON.stringify(xhr.request)) :
                '';
              let responseObject = xhr.response ?
                JSON.parse(JSON.stringify(xhr.response)) :
                '';
              recordTransformedObject(xhr, requestObject, responseObject);
            }
          }
        }
      });

      ['GET', 'PUT', 'POST', 'PATCH', 'DELETE'].forEach(method => {
        cy.route({
          method: method,
          url: '**'
        });
      });
    }

    if (automocker.isMocking) {

      // Jaime Pillora <dev@jpillora.com> - MIT Copyright 2018
      // const xHookUrl = 'https://unpkg.com/xhook@latest/dist/xhook.min.js';
      // cy.request(xHookUrl)
      //   .then(response => {
      //     xHookPackage = response.body;
      //   });

      Cypress.on('window:before:load', win => {

        // load the library in the cypress window, creates a 'xhook' object on the Window
        win.eval(xHookPackage);
        // tap into the .before() method 
        win.xhook.before(req => {

          const apiKey = req.method + '.' + req.url.split('?')[0];
          let mock = null;
          if (!apiKeyToCallCounts[apiKey]) {
            apiKeyToCallCounts[apiKey] = 1;
          }
          console.log(apiKey);
          for (let i = 0; i < mockArray.length; i++) {
            let testMock = mockArray[i];
            if (apiKey === (testMock.method + '.' + testMock.path)) {
              mock = testMock;
              if (testMock.count === apiKeyToCallCounts[apiKey]) {
                break;
              }
            }
          }
          if (mock) {
            console.log('mocking ' + apiKey + ', count ' + apiKeyToCallCounts[apiKey] + ', with ' + JSON.stringify(mock));
            ++apiKeyToCallCounts[apiKey];
            return {
              status: mock.status,
              text: mock.body
            }
          }
        });
      });
    }
  });

  Cypress.Commands.add('automockWaitOnPendingAPIs', () => {
    return new Cypress.Promise((resolve, reject) => {
      if (pendingApiCount) {
        console.log('waiting on APIs to complete');
        completedPendingRequestsFunc = function () {
          resolve();
        };
      } else {
        resolve();
      }
    });
  });

  Cypress.Commands.add('writeMockServer', () => {
    if (currentMockFileName !== null && recordedApis) {
      let apiCounter = {};

      recordedApis.forEach(recordedApi => {
        let outPath = recordedApi.path;
        if (outPath[outPath.length - 1] === '/') {
          outPath = outPath.substr(0, outPath.length - 1);
        }
        if (outPath[0] === '/') {
          outPath = outPath.substr(1);
        }
        outPath += recordedApi.query;
        if (apiCounter[outPath]) {
          ++apiCounter[outPath];
        } else {
          apiCounter[outPath] = 1;
        }
        outPath += '.' + recordedApi.method + apiCounter[outPath];

        if (recordedApi.contentType.indexOf('json') !== -1) {
          outPath += '.json';
        } else if (recordedApi.contentType.indexOf('text') !== -1) {
          outPath += '.txt';
        }
        recordedApi.fixture = outPath;
        cy.writeFile(currentMockFixtureName + '/' + outPath, recordedApi.response);
      });
      recordedApis.version = version;
      cy.writeFile(currentMockFileName, recordedApis);


      currentMockFileName = null;
    } else {
      currentMockFileName = null;
    }
  });

  automocker = window.Cypress.autoMocker = {
    isRecording: false,
    isMocking: false,
    mockResponse: request => {
      if (automocker.isMocking) {
        let key = getApiKey(request);
        let mock = null;
        if (apiKeyToMocks.hasOwnProperty(key)) {
          const apiCount = apiKeyToCallCounts[key]++;
          if (apiCount < apiKeyToMocks[key].length) {
            mock = apiKeyToMocks[key][apiCount];
          }
        }

        if (currentOptions.resolveMockFunc) {
          mock = currentOptions.resolveMockFunc(request, mockArray, mock);
        }

        if (mock) {
          console.log('MOCKING ' + request.url);
          return {
            status: mock.status,
            statusText: mock.statusText,
            response: JSON.stringify(mock.response)
          };
        }

      } else if (automocker.isRecording) {
        function prepareOnLoadHandler(xhr) {
          (function () {
            const old_onload = xhr.onload;
            const url = xhr.url;
            const method = xhr.method;

            xhr.onload = () => {

              if (old_onload) {
                old_onload();
              }
              let parsed = parseUri(url);
              let query = '';
              var blobResponseObject = null;

              console.log('RECORD: ' + url);

              if (typeof xhr.response === 'object') {
                var fr = new FileReader();
                fr.onload = function (e) {
                  var blobText = e.target.result;
                  blobResponseObject = JSON.parse(blobText);
                  let requestObject = xhr.request ?
                    JSON.parse(JSON.stringify(xhr.request)) :
                    '';
                  let responseObject;
                  if (!blobResponseObject) {
                    responseObject = xhr.response ?
                      JSON.parse(JSON.stringify(xhr.response)) :
                      '';
                  } else {
                    responseObject = blobResponseObject;
                  }
                  recordTransformedObject(xhr, requestObject, responseObject);
                };
                fr.readAsText(xhr.response);
              } else {
                let requestObject = xhr.request ?
                  JSON.parse(JSON.stringify(xhr.request)) :
                  '';
                let responseObject = xhr.response ?
                  JSON.parse(JSON.stringify(xhr.response)) :
                  '';
                recordTransformedObject(xhr, requestObject, responseObject);
              }
            };
          })();
        }
        prepareOnLoadHandler(request);
      }
      if (automocker.isMocking) {
        console.log(
          'MOCKING ON, but letting this fall through: ' + request.url
        );
      }
      ++pendingApiCount;
      return false;
    },

    onloadstart: event => { },

    onloadend: event => {
      --pendingApiCount;
      if (!pendingApiCount && completedPendingRequestsFunc) {
        completedPendingRequestsFunc();
        completedPendingRequestsFunc = null;
      }
    }
  };

  function startApiRecording() {
    automocker.isRecording = true;
    recordedApis = [];
  }

  function startApiMocking(mocks) {
    automocker.isMocking = true;
    apiKeyToMocks = {};
    apiKeyToCallCounts = {};
    mockArray = mocks.recordings;

    console.log('USING MOCK SERVER');

    mockArray.forEach(function (mock) {
      const key = getApiKey(mock);
      if (!apiKeyToMocks.hasOwnProperty(key)) {
        apiKeyToMocks[key] = [];
        apiKeyToCallCounts[key] = 0;
      }
      apiKeyToMocks[key].push(mock);
      cy.readFile(mock.fixturePath).then(contents => {
        mock.body = contents;
      });
    });
  }

  function setOptions(options) {
    // create & set up default options
    if (!options) {
      options = {};
    }

    if (options.isCustomMock == undefined) {
      options.isCustomMock = false;
    }
    currentOptions = options;
    return options;
  }

  function getApiKey(api) {
    let path = api.path;
    if (api.url) {
      path = parseUri(api.url).path;
    }

    return api.method + '.' + path;
  }

  // (c) Steven Levithan <stevenlevithan.com>
  // MIT License

  function parseUri(str) {
    var o = parseUri.options,
      m = o.parser[o.strictMode ? 'strict' : 'loose'].exec(str),
      uri = {},
      i = 14;

    while (i--) uri[o.key[i]] = m[i] || '';

    uri[o.q.name] = {};
    uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
      if ($1) uri[o.q.name][$1] = $2;
    });

    return uri;
  }

  parseUri.options = {
    strictMode: false,
    key: [
      'source',
      'protocol',
      'authority',
      'userInfo',
      'user',
      'password',
      'host',
      'port',
      'relative',
      'path',
      'directory',
      'file',
      'query',
      'anchor'
    ],
    q: {
      name: 'queryKey',
      parser: /(?:^|&)([^&=]*)=?([^&]*)/g
    },
    parser: {
      strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
      loose: /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
    }
  };
}  