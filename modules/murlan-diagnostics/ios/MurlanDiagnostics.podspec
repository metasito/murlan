Pod::Spec.new do |s|
  s.name = 'MurlanDiagnostics'
  s.version = '1.0.0'
  s.summary = 'Host time, memory, audio onsets and motion for the Murlan bench'
  s.homepage = 'https://github.com/metasito/murlan'
  s.license = 'UNLICENSED'
  s.author = 'Murlan'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'ReplayKit', 'CoreMotion', 'AVFAudio'
end
