/**
 * @license
 * Copyright (c) 2017 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import { Spec } from './spec.js';
import { Topic } from './topic.js';
import { Test } from './test.js';
import { cloneableResult } from './util.js';

/**
 * These are the query params that are observed and used as configuration by a
 * `Suite` if they are present in the URL. In the base implementation, these
 * are primarily used when running isolated tests.
 */
export interface SuiteQueryParams {
  [index:string]: string | void;
  testrunner_suite_address?: string;
  testrunner_muted?: void;
}

/**
 * A `SuiteAddress` describes the logical position of a `Test` in the hierarchy
 * of a given `Suite`. It always points to a `Spec` by index, a `Topic` by array
 * of indicies (e.g., `[0, 1, 2]` would refer to the second subtopic of the
 * first subtopic of the zeroeth root topic of a given `Spec`), and a `Test` by
 * index.
 */
export interface SuiteAddress {
  spec: number;
  topic: number[];
  test: number;
}

/**
 * A `Suite` represents an ordered set of `Spec` instances. Typically, `Spec`
 * instances are created for each module in a library to represent their
 * relevant topics and tests, and then imported and composed into a `Suite` in
 * order to be invoked. For example:
 *
 * ```javascript
 * import { Suite } from '../../@0xcda7a/test-runner/suite.js';
 * import { fooSpec } from './lib/foo-spec.js';
 * import { barSpec } from './lib/bar-spec.js';
 *
 * const suite = new Suite([
 *   fooSpec,
 *   barSpec
 * ]);
 *
 * // Start the test suite:
 * suite.run();
 * ```
 */
export class Suite {
  protected specs: Spec[];
  protected address: SuiteAddress | null;

  readonly isMuted: boolean;

  queryParams: SuiteQueryParams;

  /**
   * The only argument that the base implementation receives is an array of
   * the specs it consists of, in the order that they should be invoked.
   */
  constructor(specs: Spec[] = []) {
    this.specs = specs;

    const queryParams: SuiteQueryParams = {};
    if (window.location != null && window.location.search != null) {
      window.location.search.slice(1).split('&').reduce((map, part) => {
        const parts = part.split('=');
        map[parts[0]] = decodeURIComponent(parts[1]);
        return map;
      }, queryParams);
    };

    this.queryParams = queryParams;
    this.address = queryParams.testrunner_suite_address
        ? JSON.parse(queryParams.testrunner_suite_address) as SuiteAddress
        : null;

    this.isMuted = 'testrunner_muted' in queryParams;
  }

  /**
   * Looks up a test within the current suite hierarchy by address. Returns
   * `null` if no test is found at the given address.
   */
  getTestByAddress(address: SuiteAddress): Test | null {
    const spec = this.specs[address.spec];
    const test = spec ? spec.getTestByAddress(address) : null;

    return test;
  }

  /**
   * Resolves an address for a given test within the current suite hierarchy.
   */
  getAddressForTest(test: Test): SuiteAddress {
    let { topic } = test;
    const testIndex = topic ? topic.tests.indexOf(test) : -1;
    const topicAddress = [];
    let specIndex = -1;

    while (topic != null) {
      const { parentTopic } = topic;

      if (parentTopic != null) {
        topicAddress.unshift(parentTopic.topics.indexOf(topic));
      } else {
        for (let i = 0; i < this.specs.length; ++i) {
          const spec = this.specs[i];

          if (spec.rootTopic === topic) {
            specIndex = i;
          }
        }
      }

      topic = parentTopic;
    }

    return { spec: specIndex, topic: topicAddress, test: testIndex };
  }

  /**
   * This method invokes the `Test`s in the `Spec`s in the `Suite`. If there
   * is a `SuiteAddress` described in the query parameters of the current
   * URL, it will invoke only the test that corresponds to that address.
   * Otherwise, it will invoke all tests sequentially in a deterministic order.
   * The returned promise resolves when all test invocations have completed.
   *
   * TODO(cdata): This method should probably also accept and respect an address
   * for a given test to run as an argument.
   */
  async run() {
    if (this.address) {
      const test = this.getTestByAddress(this.address);

      if (test != null) {
        await this.testRun(test);
      }
    } else {
      for (let i = 0; i < this.specs.length; ++i) {
        const spec = this.specs[i];

        if (!this.isMuted) {
          console.log(`%c ${spec.rootTopic!.description} `,
              `background-color: #bef; color: #246;
              font-weight: bold; font-size: 24px;`);
        }

        await this.topicRun(spec.rootTopic!, i);
      }
    }
  }

  protected async topicRun(topic: Topic,
      specIndex: number,
      topicAddress: number[] = []) {
    for (let i = 0; i < topic.tests.length; ++i) {
      const address: SuiteAddress = {
        spec: specIndex,
        topic: topicAddress,
        test: i
      };

      const test = this.getTestByAddress(address);

      if (test != null) {
        await this.testRun(test);
      }
    }

    for (let i = 0; i < topic.topics.length; ++i) {
      topicAddress.push(i);
      await this.topicRun(topic.topics[i], specIndex, topicAddress);
      topicAddress.pop();
    }
  }

  protected async testRun(test: Test) {
    if (test == null) {
      throw new Error('No test found!');
    }

    const result = await test.run(this);

    if (!this.isMuted) {
      // TODO(cdata): This should all be moved to an external reporter
      const resultString = result.passed ? ' PASSED ' : ' FAILED ';
      const resultColor = result.passed ? 'green' : 'red';

      const resultLog = [`${test.behaviorText}... %c${resultString}`,
          `color: #fff; font-weight: bold; background-color: ${resultColor}`];

      if ((test as any).isolated) {
        resultLog[0] = `%c ISOLATED %c ${resultLog[0]}`;
        resultLog.splice(1, 0,
            `background-color: #fd0; font-weight: bold; color: #830`, ``);
      }

      console.log(...resultLog);
    }

    window.top.postMessage(cloneableResult(result), window.location.origin);
  }
}
