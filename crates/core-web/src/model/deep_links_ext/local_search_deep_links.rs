use crate::model::deep_links_ext::DeepLinksExt;
use rillio_core::deep_links::LocalSearchItemDeepLinks;

impl DeepLinksExt for LocalSearchItemDeepLinks {
    fn into_web_deep_links(self) -> Self {
        Self {
            search: self.search.replace("stremio://", "#"),
        }
    }
}
