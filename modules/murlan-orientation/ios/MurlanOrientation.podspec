Pod::Spec.new do |s|
  s.name = 'MurlanOrientation'
  s.version = '1.0.0'
  s.summary = 'Landscape for the table on every connected scene, and what UIKit says about it'
  s.homepage = 'https://github.com/metasito/murlan'
  s.license = 'UNLICENSED'
  s.author = 'Murlan'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
  s.frameworks = 'UIKit'
end
