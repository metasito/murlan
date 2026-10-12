Pod::Spec.new do |s|
  s.name = 'MurlanDiagnostics'
  s.version = '1.0.0'
  s.summary = 'Host time, memory, audio onsets and motion for the Murlan bench, and the app\'s React Native flags'
  s.homepage = 'https://github.com/metasito/murlan'
  s.license = 'UNLICENSED'
  s.author = 'Murlan'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'React-Core'
  # Before `install_modules_dependencies`, which merges its own settings into these.
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  unless defined?(install_modules_dependencies)
    require File.join(File.dirname(`node --print "require.resolve('react-native/package.json')"`), "scripts/react_native_pods")
  end
  install_modules_dependencies(s)
  s.source_files = '*.{swift,h,mm}'
  s.public_header_files = 'MurlanReactNativeFlags.h'
  s.frameworks = 'ReplayKit', 'CoreMotion', 'AVFAudio'
end
