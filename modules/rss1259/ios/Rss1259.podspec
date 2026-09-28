# [RESEARCH-1259] never merged
Pod::Spec.new do |s|
  s.name           = 'Rss1259'
  s.version        = '0.1.0'
  s.summary        = 'Process memory and audio session readings for the #1259 soak'
  s.description    = 'Process memory and audio session readings for the #1259 soak'
  s.license        = 'MIT'
  s.author         = 'murlan'
  s.homepage       = 'https://github.com/metasito/murlan'
  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/metasito/murlan.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES'
  }
end
