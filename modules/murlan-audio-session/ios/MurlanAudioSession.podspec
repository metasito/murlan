Pod::Spec.new do |s|
  s.name = 'MurlanAudioSession'
  s.version = '1.0.0'
  s.summary = 'Output latency and IO buffer for the audio engine'
  s.homepage = 'https://github.com/metasito/murlan'
  s.license = 'UNLICENSED'
  s.author = 'Murlan'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'AVFAudio'
end
