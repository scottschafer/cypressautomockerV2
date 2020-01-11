## cypressautomockerV2

This tool is built on top of the open-source testing platform [Cypress.io](https://www.cypress.io/) to allow recording API results and replaying the APIs as a mock server.

Unlike the previous version (cypressautomocker), this does not require that your client application be modified, and it records APIs to separate fixture files. However, as Cypress doesn't yet support truly dynamic API stubbing based on the request, it uses XHook to mock those APIs.

![cypress auto mocker example tests running](https://user-images.githubusercontent.com/1271364/39590019-acdb52ce-4ecd-11e8-94ff-c33cc3894ac7.gif)

##### Folder layout

There are three subfolders within the head directory:
1. example: Contains a simple application to test against that implements APIs with changing responses, along with an example Cypress test.
2. include-in-tests: Contains a library to include in your in your test suite,

##### Running the example

To install and run the example, run the following:
```
cd example
npm install
npm run start
```

You should see `Example app listening at http://localhost:1337` which means that the local server is running on port 1337. It will also open Cypress, allowing you to run the test.

The first time you run the test, our tool will record the API results to the file example/cypress/automocks/testCounter.json. The next time the test is run, it will automatically use the contents of the file to mock the APIs. 

You can control the recording and playback behavior using the (optional) automocker field in cypress.json:
```
  "automocker": {
    "record": true,
    "playback": true
  }
```

The default (that is, if "automocker" doesn't exist) is to treat both record and playback as true, which means that it will automatically record API calls (if the proper commands are called in the tests) if the mock file does not exits, and will play them back as mocks if they do exist.

##### Integrating Into Your Own Web Application and tests

Integrating this tool into your web application involves a few steps:

1. Add the cypressautomocker to your project:
```
npm install --save cypressautomocker
```

2. Add the following to cypress/support/commands.js
```
import registerAutoMockCommands from 'cypressautomocker/include-in-tests';
registerAutoMockCommands();
```

3. In each of your tests, add the following:

```
  const MOCK_FILENAME = 'testCounter';
  const MOCK_VERSION = 1;

  before(() => {
    cy.automock(MOCK_FILENAME, MOCK_VERSION);
  });

  after(() => {
    cy.automockEnd();
  });
```

The version is saved into the recorded file. When loading the mock for playback, if the version doesn't match, the file is ignored and a new recording can take place. When your tests or client app changes so that new APIs need to be recorded, you can simply bump the version.

Additionally, the `cy.automock()` takes an optional `options` parameter. See below:

```
    cy.automock(MOCK_FILENAME, MOCK_VERSION, {
      verbose: true,       // do we log verbosely to the console
      includeQuery: false,  // do we consider query parameters as part of the API
      resolveMockFunc: (request, mockArray, mock) => {
        console.log(request.method + ' ' + request.url);
        // just return the resolved mock. This is a no-op. We could resolve to a different one in mockArray
        return mock;
      }
    });
```

If this function is passed, it will be called to look up a recorded mock. The function will be called with these parameters:
  ```
    - request: XMLHttpRequest
    - mockArray: Array<{
        method: string,
        path: string,
        query: string,
        request: string,
        response: string;
        status: number;
        statusText: string;
        contentType: string; }>;
     - mock: an entry in mockArray that would be returned, or null
  It should return either mock, or an entry from mockArray
```

5. Wait for APIs to complete using cy.automockWaitOnPendingAPIs();
This library does not use fixtures, so there is no way to alias a route and wait for it to complete. However, the
`cy.automockWaitOnPendingAPIs()` can be used to wait for outstanding APIs to complete before proceeding.

##### Issues and remedies
This library records API calls and replays them in the exact order in which they were recorded. It ignores all query parameters and uses a combination of the method and path as the key. This means that if `GET /counter` returns three 
different responses when the APIs are recorded, those same three responses will be replayed when the mock file is present.

If you change your tests so that APIs are called in a different order and you have a recorded mock file, your tests may
fail. One solution is to simply delete the contents of the `automocks` folder and also the recording to be re-generated.

The mocked APIs will be much faster than actual calls to the server. In some cases, this could cause your tests to run
differently. This can surface actual bugs in your web application, for example, your code might rely on one API to complete
after another has completed, and faster APIs could surface race conditions.

If your tests cannot have deterministic outcomes, you may wish to use `resolveMockFunc()` as documented above.

This library has not been tested with code that reloads pages. It's possible that it could be made to work, although `installCypressHooks` would need to be called in both places. This usage is not recommended.

## Project status
This project is not really being actively maintained. I have dipped into it occasionally, but we are using a different
approach to testing now and so keeping this updated is not a top priority for me.

I hope you find it useful, and will post occasional updates if the need arises and time allows.
