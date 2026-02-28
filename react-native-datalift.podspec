require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-datalift"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = "DataLift"

  # iOS 13+ required — Vision framework (OCR) needs iOS 13
  s.platforms    = { :ios => "13.0" }

  s.source       = {
    :git => package.dig("repository", "url") || "",
    :tag => "#{s.version}"
  }

  # Include the ObjC bridge (.m) and all Swift sources
  s.source_files = "ios/**/*.{h,m,mm,swift}"

  # Required for Swift ↔ ObjC interop and module map generation
  s.pod_target_xcconfig = {
    "DEFINES_MODULE"          => "YES",
    "SWIFT_COMPILATION_MODE"  => "wholemodule",
    "BUILD_LIBRARY_FOR_DISTRIBUTION" => "NO"
  }

  # Old Architecture (bridge) — works via interop layer on RN 0.76+
  s.dependency "React-Core"

end
