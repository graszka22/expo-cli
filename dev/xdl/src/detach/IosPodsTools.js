// Copyright 2015-present 650 Industries. All rights reserved.

'use strict';

import fs from 'fs';
import glob from 'glob';
import indentString from 'indent-string';
import 'instapromise';
import JsonFile from '@exponent/json-file';
import path from 'path';

/**
 *  @param pathToTemplate path to template Podfile
 *  @param pathToOutput path to render final Podfile
 *  @param moreSubstitutions dictionary of additional substitution keys and values to replace
 *         in the template, such as: TARGET_NAME, EXPONENT_ROOT_PATH, REACT_NATIVE_PATH
 */
async function renderPodfileAsync(
  pathToTemplate,
  pathToOutput,
  moreSubstitutions,
  sdkVersion = 'UNVERSIONED'
) {
  if (!moreSubstitutions) {
    moreSubstitutions = {};
  }
  let templatesDirectory = path.dirname(pathToTemplate);
  let templateString = await fs.promise.readFile(pathToTemplate, 'utf8');

  let reactNativePath = moreSubstitutions.REACT_NATIVE_PATH;
  let rnDependencyOptions;
  if (reactNativePath) {
    rnDependencyOptions = { reactNativePath };
  } else {
    rnDependencyOptions = {};
  }

  let versionedDependencies = await renderVersionedReactNativeDependenciesAsync(
    templatesDirectory
  );
  let versionedPostinstalls = await renderVersionedReactNativePostinstallsAsync(
    templatesDirectory
  );
  let podDependencies = await renderPodDependenciesAsync(
    path.join(templatesDirectory, 'dependencies.json'),
    { isPodfile: true }
  );

  let substitutions = {
    EXPONENT_CLIENT_DEPS: podDependencies,
    PODFILE_UNVERSIONED_RN_DEPENDENCY: renderUnversionedReactNativeDependency(
      rnDependencyOptions,
      sdkVersion
    ),
    PODFILE_UNVERSIONED_POSTINSTALL: renderUnversionedPostinstall(),
    PODFILE_DETACHED_POSTINSTALL: renderDetachedPostinstall(sdkVersion),
    PODFILE_VERSIONED_RN_DEPENDENCIES: versionedDependencies,
    PODFILE_VERSIONED_POSTINSTALLS: versionedPostinstalls,
    PODFILE_TEST_TARGET: renderPodfileTestTarget(reactNativePath),
    ...moreSubstitutions,
  };

  let result = templateString;
  for (let key in substitutions) {
    if (substitutions.hasOwnProperty(key)) {
      let replacement = substitutions[key];
      result = result.replace(
        new RegExp(`\\\$\\\{${key}\\\}`, 'g'),
        replacement
      );
    }
  }

  await fs.promise.writeFile(pathToOutput, result);
}

async function renderExponentViewPodspecAsync(
  pathToTemplate,
  pathToOutput,
  moreSubstitutions
) {
  let templatesDirectory = path.dirname(pathToTemplate);
  let templateString = await fs.promise.readFile(pathToTemplate, 'utf8');
  let dependencies = await renderPodDependenciesAsync(
    path.join(templatesDirectory, 'dependencies.json'),
    { isPodfile: false }
  );
  let result = templateString.replace(
    /\$\{IOS_EXPONENT_VIEW_DEPS\}/g,
    dependencies
  );
  if (moreSubstitutions && moreSubstitutions.IOS_EXPONENT_CLIENT_VERSION) {
    result = result.replace(
      /\$\{IOS_EXPONENT_CLIENT_VERSION\}/g,
      moreSubstitutions.IOS_EXPONENT_CLIENT_VERSION
    );
  }

  await fs.promise.writeFile(pathToOutput, result);
}

function renderUnversionedReactNativeDependency(options, sdkVersion) {
  if (sdkVersion === '14.0.0') {
    return indentString(
      `
${renderUnversionedReactDependency(options)}
`,
      2
    );
  } else {
    return indentString(
      `
${renderUnversionedReactDependency(options)}
${renderUnversionedYogaDependency(options)}
`,
      2
    );
  }
}

function renderUnversionedReactDependency(options) {
  let attributes;
  if (options.reactNativePath) {
    attributes = {
      path: options.reactNativePath,
    };
  } else {
    throw new Error(`Unsupported options for RN dependency: ${options}`);
  }

  attributes.subspecs = [
    'Core',
    'ART',
    'DevSupport',
    'RCTActionSheet',
    'RCTAnimation',
    'RCTCameraRoll',
    'RCTGeolocation',
    'RCTImage',
    'RCTNetwork',
    'RCTText',
    'RCTVibration',
    'RCTWebSocket',
  ];

  return `pod 'React',
${indentString(renderDependencyAttributes(attributes), 2)}`;
}

function renderUnversionedYogaDependency(options) {
  let attributes;
  if (options.reactNativePath) {
    attributes = {
      path: path.join(options.reactNativePath, 'ReactCommon', 'yoga'),
    };
  } else {
    throw new Error(`Unsupported options for Yoga dependency: ${options}`);
  }
  return `pod 'Yoga',
${indentString(renderDependencyAttributes(attributes), 2)}`;
}

function renderDependencyAttributes(attributes) {
  let attributesStrings = [];
  for (let key of Object.keys(attributes)) {
    let value = JSON.stringify(attributes[key], null, 2);
    attributesStrings.push(`:${key} => ${value}`);
  }
  return attributesStrings.join(',\n');
}

async function renderVersionedReactNativeDependenciesAsync(templatesDirectory) {
  // TODO: write these files with versioning script
  return concatTemplateFilesInDirectoryAsync(
    path.join(templatesDirectory, 'versioned-react-native', 'dependencies')
  );
}

async function renderVersionedReactNativePostinstallsAsync(templatesDirectory) {
  // TODO: write these files with versioning script
  return concatTemplateFilesInDirectoryAsync(
    path.join(templatesDirectory, 'versioned-react-native', 'postinstalls')
  );
}

async function concatTemplateFilesInDirectoryAsync(directory) {
  let templateFilenames = await glob.promise(path.join(directory, '*.rb'));
  let templateStrings = [];
  await Promise.all(
    templateFilenames.map(async filename => {
      let templateString = await fs.promise.readFile(filename, 'utf8');
      if (templateString) {
        templateStrings.push(templateString);
      }
    })
  );
  return templateStrings.join('\n');
}

function renderDetachedPostinstall(sdkVersion) {
  let podName = sdkVersion === '14.0.0' ? 'ExponentView' : 'ExpoKit';

  let podsRootSub = '${PODS_ROOT}';
  return `
    if target.pod_name == '${podName}'
      target.native_target.build_configurations.each do |config|
        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
        config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'EX_DETACHED=1'
        # needed for GoogleMaps 2.x
        config.build_settings['FRAMEWORK_SEARCH_PATHS'] ||= []
        config.build_settings['FRAMEWORK_SEARCH_PATHS'] << '${podsRootSub}/GoogleMaps/Base/Frameworks'
        config.build_settings['FRAMEWORK_SEARCH_PATHS'] << '${podsRootSub}/GoogleMaps/Maps/Frameworks'
      end
    end
`;
}

function renderUnversionedPostinstall() {
  return `
    # Build React Native with RCT_DEV enabled
    next unless target.pod_name == 'React'
    target.native_target.build_configurations.each do |config|
      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)']
      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] << 'RCT_DEV=1'
    end
`;
}

function renderPodfileTestTarget(reactNativePath) {
  return `
  # if you run into problems pre-downloading this, rm Pods/Local\ Podspecs/RCTTest.podspec.json
  target 'ExponentIntegrationTests' do
    inherit! :search_paths
    pod 'RCTTest', :podspec => './RCTTest.podspec', :path => '${reactNativePath}'
  end
`;
}

async function renderPodDependenciesAsync(dependenciesConfigPath, options) {
  let dependencies = await new JsonFile(dependenciesConfigPath).readAsync();
  let type = options.isPodfile ? 'pod' : 's.dependency';
  let depsStrings = dependencies.map(
    dependency => `  ${type} '${dependency.name}', '${dependency.version}'`
  );
  return depsStrings.join('\n');
}

export { renderExponentViewPodspecAsync, renderPodfileAsync };
