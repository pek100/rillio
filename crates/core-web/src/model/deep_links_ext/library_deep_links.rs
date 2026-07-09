use crate::model::deep_links_ext::DeepLinksExt;
use rillio_core::deep_links::LibraryDeepLinks;

impl DeepLinksExt for LibraryDeepLinks {
    fn into_web_deep_links(self) -> Self {
        Self {
            library: self.library.replace("stremio://", "#"),
        }
    }
}
