module.exports = registerAutoMockCommands;

function registerAutoMockCommands() {

  let log = console.log;

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
  let automocker = {
    isRecording: false,
    isMocking: false
  };

  // the default mock resolution function, can be overridden in options
  const defaultResolveMockFunc = (req, mockArray) => {
    const apiKey = getApiKey(req);
    let mock = null;
    if (!apiKeyToCallCounts[apiKey]) {
      apiKeyToCallCounts[apiKey] = 1;
    }

    for (let i = 0; i < mockArray.length; i++) {
      let testMock = mockArray[i];
      if (apiKey === getApiKey(testMock)) {
        mock = testMock;
        if (testMock.count === apiKeyToCallCounts[apiKey]) {
          break;
        }
      }
    }
    if (mock) {
      ++apiKeyToCallCounts[apiKey];
    }
    return mock;
  }

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
      } catch (e) {}
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
    if (currentOptions.includeQuery && transformedObject.query) {
      outPath += '?' + transformedObject.query;
    }
    outPath += '.' + transformedObject.method;
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

    log('recording ' + outPath);
    recordedApis.push(transformedObject);
  }

  Cypress.Commands.add('automock', (sessionName, version, options) => {

    currentVersion = version;
    if (!xHookPackage) {
      const xHookUrl = 'https://cdnjs.cloudflare.com/ajax/libs/xhook/1.4.9/xhook.min.js';
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
    currentOptions = options = {
      isCustomMock: false,
      verbose: false,
      includeQuery: false,
      resolveMockFunc: defaultResolveMockFunc,
      ...options
    };
    log = options.verbose ? console.log : function () {};

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
      log('mockFilePath = ' + mockFilePath);
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
              log('loaded JSON, version = ' + contents.version);
              if (contents.version === version) {
                sessionFileExists = true;
                startApiMocking(contents);
              } else {
                cy.exec('rm ' + absolutePathToMockFile);
              }
              if (!sessionFileExists) {
                // file doesn't exist, so start recording if allowed
                if (!currentOptions.isCustomMock && automockRecord) {
                  startApiRecording();
                }
              }
            });
          } else {
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

          recordedApis.forEach(recordedApi => {
            let outPath = recordedApi.fixturePath;
            cy.writeFile(outPath, recordedApi.response);
          });

          recordedApis.forEach(recordedApi => {
            delete recordedApi.response;
          });

          cy.writeFile(currentMockFileName, {
            version: currentVersion,
            recordings: recordedApis
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

      Cypress.on('window:before:load', win => {

        // load the library in the cypress window, creates a 'xhook' object on the Window
        win.eval(xHookPackage);

        // Remove fetch from the global window object, so we automatically trigger
        // the XHR fallback. Should be the same as the jQuery implementation?
        delete win.fetch;
        win.fetch = null;

        // tap into the .before() method
        win.xhook.before(req => {

          const apiKey = getApiKey(req);

          let mock = defaultResolveMockFunc(req, mockArray, null);
          if (currentOptions.resolveMockFunc !== defaultResolveMockFunc) {
            mock = currentOptions.resolveMockFunc(req, mockArray, mock);
          }

          if (mock) {
            log('mocking ' + apiKey + ', count ' + apiKeyToCallCounts[apiKey] + ', with ' + JSON.stringify(mock));
            let response = {
              status: mock.status
            };
            if (mock.contentType.includes('text/html')) {
              response.text = mock.body;
            } else if (mock.contentType.includes('application/json')) {
              response.contentType = mock.contentType;
              response.headers = {
                'Content-type': mock.contentType
              };
              let body = mock.body;
              body = JSON.stringify(mock.body);
              response.text = body;
            }
            return response;
          } else {
            log('CypressAutoMocker: allowing API to fall through: ' + apiKey +
              '. This may indicate that your tests have changed and you should update the version passed to cy.automock');
          }
        });
      });
    }
  });

  Cypress.Commands.add('automockWaitOnPendingAPIs', () => {
    return new Cypress.Promise((resolve, reject) => {
      if (pendingApiCount) {
        log('waiting on APIs to complete');
        completedPendingRequestsFunc = function () {
          resolve();
        };
      } else {
        resolve();
      }
    });
  });

  function startApiRecording() {
    log('CypressAutoMocker: recording APIs');

    automocker.isRecording = true;
    recordedApis = [];
  }

  function startApiMocking(mocks) {
    automocker.isMocking = true;
    apiKeyToMocks = {};
    apiKeyToCallCounts = {};
    mockArray = mocks.recordings;

    log('CypressAutoMocker: mocking API results');

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

  function getApiKey(api) {
    if (api.url) {
      let parsedUrl = parseUri(api.url);
      api.path = parsedUrl.path;
      api.query = parsedUrl.query;
    }

    //   if (currentOptions.includeQuery) {
    //     path = api.url;
    //   } else {
    //     path = parseUri(api.url).path;
    //   }
    // }
    let result = api.method + '.' + api.path;
    if (currentOptions.includeQuery && api.query && !api.url) {
      result += '?' + api.query;
    }
    return result;
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